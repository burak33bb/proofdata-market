import { list, put } from "@vercel/blob";
import { verifyWalletProof, type WalletProof } from "../_lib/wallet-proof";

const LISTING_PREFIX = "proofdata-listings/v2/";
const MANIFEST_PREFIX = "proofdata-market/v2/";
const SHELBY_RPC = "https://api.shelbynet.shelby.xyz/shelby";

type DatasetPreview =
  | { kind: "table"; headers: string[]; rows: string[][]; rowCount?: number }
  | { kind: "text"; text: string }
  | { kind: "image" | "audio" | "video" | "pdf" | "file" };

type ListingManifest = {
  version: 1;
  name: string;
  description: string;
  category: string;
  price: number;
  format: string;
  sizeBytes: number;
  mimeType: string;
  blobName: string;
  dataRoot: string;
  createdAt: number;
  preview: DatasetPreview;
  originalFileName?: string;
  source?: string;
  geography?: string;
  language?: string;
  collectedFrom?: string;
  collectedTo?: string;
  updateFrequency?: string;
  labeled?: boolean;
  containsPersonalData?: boolean;
  useCases?: string[];
  license?: {
    type: string;
    commercialUse: boolean;
    modelTraining: boolean;
    redistribution: boolean;
    duration: string;
    updatesIncluded: boolean;
  };
  encryption?: {
    algorithm: "AES-GCM";
    iv: string;
    keyId: string;
    originalSize: number;
  };
  previousDatasetId?: string;
};

type StoredListing = {
  ownerAddress: string;
  manifestBlobName: string;
  indexedAt: number;
  updatedAt?: number;
  status?: "active" | "inactive";
  version?: number;
  revisions?: Array<{
    version: number;
    name: string;
    description: string;
    category: string;
    price: number;
    updatedAt: number;
  }>;
  reports?: number;
  views?: number;
  manifest: ListingManifest;
};

type ListingChanges = {
  name: string;
  description: string;
  category: string;
  price: number;
};

function validManifest(value: unknown): value is ListingManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<ListingManifest>;
  const previewKinds = ["table", "text", "image", "audio", "video", "pdf", "file"];
  return (
    manifest.version === 1 &&
    typeof manifest.name === "string" &&
    manifest.name.trim().length > 0 &&
    manifest.name.length <= 120 &&
    typeof manifest.description === "string" &&
    manifest.description.length <= 500 &&
    typeof manifest.category === "string" &&
    manifest.category.length <= 40 &&
    typeof manifest.price === "number" &&
    Number.isFinite(manifest.price) &&
    manifest.price >= 0 &&
    manifest.price <= 1_000_000_000 &&
    typeof manifest.format === "string" &&
    manifest.format.length <= 12 &&
    typeof manifest.sizeBytes === "number" &&
    Number.isSafeInteger(manifest.sizeBytes) &&
    manifest.sizeBytes >= 0 &&
    manifest.sizeBytes <= 100 * 1024 * 1024 &&
    typeof manifest.mimeType === "string" &&
    manifest.mimeType.length <= 120 &&
    typeof manifest.blobName === "string" &&
    manifest.blobName.startsWith("proofdata/") &&
    manifest.blobName.length <= 300 &&
    typeof manifest.dataRoot === "string" &&
    manifest.dataRoot.length >= 16 &&
    manifest.dataRoot.length <= 256 &&
    typeof manifest.createdAt === "number" &&
    Number.isFinite(manifest.createdAt) &&
    (!manifest.originalFileName ||
      (typeof manifest.originalFileName === "string" && manifest.originalFileName.length <= 220)) &&
    (!manifest.source ||
      (typeof manifest.source === "string" && manifest.source.length <= 300)) &&
    (!manifest.geography ||
      (typeof manifest.geography === "string" && manifest.geography.length <= 100)) &&
    (!manifest.language ||
      (typeof manifest.language === "string" && manifest.language.length <= 100)) &&
    (!manifest.useCases ||
      (Array.isArray(manifest.useCases) &&
        manifest.useCases.length <= 8 &&
        manifest.useCases.every((item) => typeof item === "string" && item.length <= 100))) &&
    (!manifest.previousDatasetId ||
      (typeof manifest.previousDatasetId === "string" &&
        manifest.previousDatasetId.length <= 700)) &&
    (!manifest.encryption ||
      (manifest.encryption.algorithm === "AES-GCM" &&
        typeof manifest.encryption.iv === "string" &&
        manifest.encryption.iv.length <= 64 &&
        typeof manifest.encryption.keyId === "string" &&
        /^[a-zA-Z0-9_-]{16,100}$/.test(manifest.encryption.keyId) &&
        Number.isSafeInteger(manifest.encryption.originalSize) &&
        manifest.encryption.originalSize >= 0)) &&
    (!manifest.license ||
      (typeof manifest.license.type === "string" &&
        typeof manifest.license.commercialUse === "boolean" &&
        typeof manifest.license.modelTraining === "boolean" &&
        typeof manifest.license.redistribution === "boolean" &&
        typeof manifest.license.duration === "string" &&
        typeof manifest.license.updatesIncluded === "boolean")) &&
    Boolean(manifest.preview) &&
    typeof manifest.preview?.kind === "string" &&
    previewKinds.includes(manifest.preview.kind) &&
    (manifest.preview.kind !== "image" ||
      !("dataUrl" in manifest.preview) ||
      (typeof manifest.preview.dataUrl === "string" &&
        manifest.preview.dataUrl.startsWith("data:image/") &&
        manifest.preview.dataUrl.length <= 220_000))
  );
}

function normalizeAddress(address: string) {
  const clean = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(clean)) return null;
  return `0x${clean.slice(2).padStart(64, "0")}`;
}

function shelbyManifestUrl(ownerAddress: string, manifestBlobName: string) {
  const path = manifestBlobName.split("/").map(encodeURIComponent).join("/");
  return `${SHELBY_RPC}/v1/blobs/${encodeURIComponent(ownerAddress)}/${path}`;
}

function responseError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function normalizedStoredListing(stored: StoredListing): StoredListing {
  return {
    ...stored,
    updatedAt: stored.updatedAt ?? stored.indexedAt,
    status: stored.status ?? "active",
    version: stored.version ?? 1,
    revisions:
      stored.revisions?.length
        ? stored.revisions
        : [
            {
              version: 1,
              name: stored.manifest.name,
              description: stored.manifest.description,
              category: stored.manifest.category,
              price: stored.manifest.price,
              updatedAt: stored.indexedAt,
            },
          ],
    reports: stored.reports ?? 0,
    views: stored.views ?? 0,
  };
}

function listingMessage(
  action: "update" | "deactivate" | "reactivate",
  datasetId: string,
  changes?: ListingChanges,
) {
  return `proofdata:listings:${action}:v1:${datasetId}:${changes ? JSON.stringify(changes) : ""}`;
}

async function loadStoredListings(token: string) {
  const result = await list({ prefix: LISTING_PREFIX, limit: 1000, token });
  return (
    await Promise.all(
      result.blobs.map(async (blob) => {
        try {
          const response = await fetch(blob.url, { cache: "no-store" });
          if (!response.ok) return null;
          const stored = (await response.json()) as StoredListing;
          if (
            !stored ||
            typeof stored.ownerAddress !== "string" ||
            typeof stored.manifestBlobName !== "string" ||
            !validManifest(stored.manifest)
          ) {
            return null;
          }
          return { blob, stored: normalizedStoredListing(stored) };
        } catch {
          return null;
        }
      }),
    )
  ).filter(
    (
      item,
    ): item is {
      blob: Awaited<ReturnType<typeof list>>["blobs"][number];
      stored: StoredListing;
    } => item !== null,
  );
}

export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return responseError("Marketplace storage is not connected.", 503);
  }

  try {
    const rows = await loadStoredListings(process.env.BLOB_READ_WRITE_TOKEN);

    return Response.json(
      {
        listings: rows
          .map((item) => item.stored)
          .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    console.error("Listing store read failed", error);
    return responseError("Marketplace listings could not be loaded.", 502);
  }
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return responseError("Marketplace storage is not connected.", 503);
  }

  try {
    const body = (await request.json()) as {
      ownerAddress?: string;
      manifestBlobName?: string;
    };
    const ownerAddress = normalizeAddress(body.ownerAddress ?? "");
    const manifestBlobName = body.manifestBlobName?.trim() ?? "";

    if (!ownerAddress) return responseError("A valid owner address is required.", 400);
    if (
      !manifestBlobName.startsWith(MANIFEST_PREFIX) ||
      manifestBlobName.length > 350 ||
      manifestBlobName.includes("..")
    ) {
      return responseError("A valid ProofData manifest is required.", 400);
    }

    const manifestResponse = await fetch(
      shelbyManifestUrl(ownerAddress, manifestBlobName),
      { cache: "no-store" },
    );
    if (!manifestResponse.ok) {
      return responseError("The listing manifest is not available on Shelby.", 422);
    }
    const contentLength = Number(manifestResponse.headers.get("content-length") ?? "0");
    if (contentLength > 256 * 1024) {
      return responseError("The listing manifest is too large.", 413);
    }

    const manifest = (await manifestResponse.json()) as unknown;
    if (!validManifest(manifest)) {
      return responseError("Shelby returned an invalid listing manifest.", 422);
    }
    const existingRows = await loadStoredListings(process.env.BLOB_READ_WRITE_TOKEN);
    const duplicate = existingRows.find(
      ({ stored: item }) =>
        item.ownerAddress === ownerAddress && item.manifest.dataRoot === manifest.dataRoot,
    );
    if (duplicate) {
      return Response.json({ listing: duplicate.stored, duplicate: true });
    }

    const stored: StoredListing = {
      ownerAddress,
      manifestBlobName,
      indexedAt: Date.now(),
      updatedAt: Date.now(),
      status: "active",
      version: 1,
      revisions: [
        {
          version: 1,
          name: manifest.name,
          description: manifest.description,
          category: manifest.category,
          price: manifest.price,
          updatedAt: Date.now(),
        },
      ],
      reports: 0,
      views: 0,
      manifest,
    };
    const safeName = `${ownerAddress.slice(2)}-${manifestBlobName
      .slice(MANIFEST_PREFIX.length)
      .replace(/[^a-zA-Z0-9._-]/g, "-")}`;

    await put(`${LISTING_PREFIX}${safeName}`, JSON.stringify(stored), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return Response.json({ listing: stored }, { status: 201 });
  } catch (error) {
    console.error("Listing store write failed", error);
    return responseError("The listing could not be saved.", 502);
  }
}

export async function PATCH(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return responseError("Marketplace storage is not connected.", 503);

  try {
    const body = (await request.json()) as {
      datasetId?: string;
      action?: "update" | "deactivate" | "reactivate";
      changes?: Partial<ListingChanges>;
      proof?: WalletProof;
    };
    if (!body.datasetId || !body.action) {
      return responseError("A listing and action are required.", 400);
    }
    const rows = await loadStoredListings(token);
    const row = rows.find(
      ({ stored }) => `${stored.ownerAddress}:${stored.manifestBlobName}` === body.datasetId,
    );
    if (!row) return responseError("Listing not found.", 404);

    let changes: ListingChanges | undefined;
    if (body.action === "update") {
      changes = {
        name: String(body.changes?.name ?? "").trim().slice(0, 120),
        description: String(body.changes?.description ?? "").trim().slice(0, 500),
        category: String(body.changes?.category ?? "").trim().slice(0, 40),
        price: Number(body.changes?.price),
      };
      if (
        !changes.name ||
        !changes.description ||
        !changes.category ||
        !Number.isFinite(changes.price) ||
        changes.price < 0 ||
        changes.price > 1_000_000_000
      ) {
        return responseError("The listing changes are invalid.", 400);
      }
    }
    const message = listingMessage(body.action, body.datasetId, changes);
    if (!verifyWalletProof(body.proof, row.stored.ownerAddress, message)) {
      return responseError("Wallet ownership verification failed.", 401);
    }

    const now = Date.now();
    const nextVersion = (row.stored.version ?? 1) + 1;
    const updated: StoredListing = {
      ...row.stored,
      updatedAt: now,
      status:
        body.action === "deactivate"
          ? "inactive"
          : body.action === "reactivate"
            ? "active"
            : row.stored.status,
      version: nextVersion,
    };
    if (changes) {
      updated.manifest = { ...updated.manifest, ...changes };
      updated.revisions = [
        ...(updated.revisions ?? []),
        { version: nextVersion, ...changes, updatedAt: now },
      ].slice(-25);
    }

    await put(row.blob.pathname, JSON.stringify(updated), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token,
    });
    return Response.json({ listing: updated });
  } catch (error) {
    console.error("Listing update failed", error);
    return responseError("The listing could not be updated.", 500);
  }
}
