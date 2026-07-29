import { list, put } from "@vercel/blob";

export const dynamic = "force-dynamic";

const ACTIVITY_PREFIX = "proofdata-activity/v2/";
const LISTING_PREFIX = "proofdata-listings/v2/";
const SHELBY_FULLNODE = "https://api.shelbynet.shelby.xyz/v1";
const TRANSFER_FUNCTION = "0x1::primary_fungible_store::transfer";

type SaleActivity = {
  version: 1;
  type: "license";
  datasetId: string;
  datasetName: string;
  buyerAddress: string;
  sellerAddress: string;
  transactionHash: string;
  price: number;
  createdAt: number;
  license?: {
    type: string;
    commercialUse: boolean;
    modelTraining: boolean;
    redistribution: boolean;
    duration: string;
    updatesIncluded: boolean;
  };
};

type StoredListing = {
  ownerAddress: string;
  manifestBlobName: string;
  manifest: {
    name: string;
    price: number;
    license?: SaleActivity["license"];
  };
};

function canonicalAddress(value: string) {
  const body = value.toLowerCase().replace(/^0x/, "").replace(/^0+/, "") || "0";
  return `0x${body}`;
}

function isHex(value: unknown, length: number): value is string {
  return typeof value === "string" && new RegExp(`^0x[0-9a-fA-F]{${length}}$`).test(value);
}

function isSaleActivity(value: unknown): value is SaleActivity {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SaleActivity>;
  return (
    item.version === 1 &&
    item.type === "license" &&
    typeof item.datasetId === "string" &&
    typeof item.datasetName === "string" &&
    typeof item.buyerAddress === "string" &&
    typeof item.sellerAddress === "string" &&
    isHex(item.transactionHash, 64) &&
    typeof item.price === "number" &&
    Number.isFinite(item.price) &&
    typeof item.createdAt === "number"
  );
}

export async function GET() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return Response.json({ error: "Activity storage is not connected." }, { status: 503 });
  }

  try {
    const result = await list({ prefix: ACTIVITY_PREFIX, limit: 1000, token });
    const activities = (
      await Promise.all(
        result.blobs.map(async (blob) => {
          try {
            const response = await fetch(blob.url, { cache: "no-store" });
            if (!response.ok) return null;
            const activity: unknown = await response.json();
            return isSaleActivity(activity) ? activity : null;
          } catch {
            return null;
          }
        }),
      )
    )
      .filter((item): item is SaleActivity => item !== null)
      .sort((a, b) => b.createdAt - a.createdAt);

    return Response.json({ activities });
  } catch (error) {
    console.error("Activity listing failed", error);
    return Response.json({ error: "Activity could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return Response.json({ error: "Activity storage is not configured." }, { status: 503 });
  }

  try {
    const body = (await request.json()) as {
      buyerAddress?: string;
      ownerAddress?: string;
      manifestBlobName?: string;
      transactionHash?: string;
    };
    if (
      !body.buyerAddress ||
      !body.ownerAddress ||
      !body.manifestBlobName ||
      !isHex(body.transactionHash, 64)
    ) {
      return Response.json({ error: "Invalid activity request." }, { status: 400 });
    }

    const datasetId = `${body.ownerAddress}:${body.manifestBlobName}`;
    const listingResult = await list({ prefix: LISTING_PREFIX, limit: 100, token });
    const listings = await Promise.all(
      listingResult.blobs.map(async (blob) => {
        try {
          const response = await fetch(blob.url, { cache: "no-store" });
          return response.ok ? ((await response.json()) as StoredListing) : null;
        } catch {
          return null;
        }
      }),
    );
    const listing = listings.find(
      (item) =>
        item &&
        canonicalAddress(item.ownerAddress) === canonicalAddress(body.ownerAddress!) &&
        item.manifestBlobName === body.manifestBlobName,
    );
    if (!listing) {
      return Response.json({ error: "The listed dataset was not found." }, { status: 404 });
    }

    const transactionResponse = await fetch(
      `${SHELBY_FULLNODE}/transactions/by_hash/${body.transactionHash}`,
      { cache: "no-store" },
    );
    if (!transactionResponse.ok) {
      return Response.json({ error: "The ShelbyNet transaction was not found." }, { status: 400 });
    }
    const transaction = (await transactionResponse.json()) as {
      success?: boolean;
      sender?: string;
      timestamp?: string;
      payload?: { function?: string; arguments?: unknown[] };
    };
    const args = transaction.payload?.arguments ?? [];
    const expectedAmount = String(Math.round(listing.manifest.price * 100_000_000));
    const paymentIsValid =
      transaction.success === true &&
      canonicalAddress(transaction.sender ?? "") === canonicalAddress(body.buyerAddress) &&
      transaction.payload?.function === TRANSFER_FUNCTION &&
      canonicalAddress(String(args[1] ?? "")) === canonicalAddress(listing.ownerAddress) &&
      String(args[2] ?? "") === expectedAmount;

    if (!paymentIsValid) {
      return Response.json({ error: "The payment does not match this dataset license." }, { status: 400 });
    }

    const activity: SaleActivity = {
      version: 1,
      type: "license",
      datasetId,
      datasetName: listing.manifest.name.slice(0, 120),
      buyerAddress: body.buyerAddress,
      sellerAddress: listing.ownerAddress,
      transactionHash: body.transactionHash,
      price: listing.manifest.price,
      createdAt: transaction.timestamp ? Math.floor(Number(transaction.timestamp) / 1000) : Date.now(),
      license: listing.manifest.license,
    };
    await put(`${ACTIVITY_PREFIX}${body.transactionHash.toLowerCase()}.json`, JSON.stringify(activity), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token,
    });

    return Response.json({ activity }, { status: 201 });
  } catch (error) {
    console.error("Activity indexing failed", error);
    return Response.json({ error: "Activity could not be indexed." }, { status: 500 });
  }
}
