import { findListing, hasLicense, loadJsonBlobs, LISTING_PREFIX, type StoredMarketListing } from "../_lib/market-storage";

export const dynamic = "force-dynamic";

const SHELBY_USD_METADATA =
  "0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1";

export async function GET(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return Response.json({ error: "Marketplace storage is unavailable." }, { status: 503 });
  }
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").toLowerCase().slice(0, 120);
  const category = url.searchParams.get("category") ?? "";
  const rows = await loadJsonBlobs<StoredMarketListing>(LISTING_PREFIX, token);
  const datasets = rows
    .map(({ value }) => ({
      id: `${value.ownerAddress}:${value.manifestBlobName}`,
      ownerAddress: value.ownerAddress,
      name: value.manifest.name,
      price: value.manifest.price,
      category: (value.manifest as { category?: string }).category ?? "Other",
      dataRoot: value.manifest.dataRoot,
      encrypted: Boolean(value.manifest.encryption),
      license: value.manifest.license ?? null,
      status: value.status ?? "active",
    }))
    .filter(
      (item) =>
        item.status === "active" &&
        (!query || item.name.toLowerCase().includes(query)) &&
        (!category || item.category === category),
    );

  return Response.json({
    protocol: "proofdata-agent-api",
    version: "1.0",
    network: "shelbynet",
    capabilities: ["discover", "quote", "license-check", "integrity-root"],
    datasets,
  });
}

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return Response.json({ error: "Marketplace storage is unavailable." }, { status: 503 });
  }
  const body = (await request.json()) as {
    action?: "quote" | "license-check";
    datasetId?: string;
    buyerAddress?: string;
  };
  const datasetId = String(body.datasetId ?? "");
  const listing = await findListing(datasetId, token);
  if (!listing) return Response.json({ error: "Dataset not found." }, { status: 404 });

  if (body.action === "license-check") {
    if (!body.buyerAddress) {
      return Response.json({ error: "buyerAddress is required." }, { status: 400 });
    }
    return Response.json({
      datasetId,
      buyerAddress: body.buyerAddress,
      licensed: await hasLicense(datasetId, body.buyerAddress, token),
    });
  }
  if (body.action === "quote") {
    return Response.json({
      datasetId,
      network: "shelbynet",
      currencyMetadata: SHELBY_USD_METADATA,
      recipient: listing.value.ownerAddress,
      amount: listing.value.manifest.price,
      amountAtomic: String(Math.round(listing.value.manifest.price * 100_000_000)),
      decimals: 8,
      integrityRoot: listing.value.manifest.dataRoot,
      license: listing.value.manifest.license ?? null,
    });
  }
  return Response.json({ error: "Unsupported agent action." }, { status: 400 });
}
