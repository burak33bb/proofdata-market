import { list } from "@vercel/blob";

export const LISTING_PREFIX = "proofdata-listings/v2/";
export const ACTIVITY_PREFIX = "proofdata-activity/v2/";

export type StoredMarketListing = {
  ownerAddress: string;
  manifestBlobName: string;
  status?: "active" | "inactive";
  views?: number;
  manifest: {
    name: string;
    price: number;
    blobName: string;
    dataRoot: string;
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
};

export type StoredLicense = {
  version: 1;
  type: "license";
  datasetId: string;
  buyerAddress: string;
  sellerAddress: string;
  transactionHash: string;
  price: number;
  createdAt: number;
};

export function shortCanonicalAddress(value: string) {
  const body = value.toLowerCase().replace(/^0x/, "").replace(/^0+/, "") || "0";
  return `0x${body}`;
}

export async function loadJsonBlobs<T>(prefix: string, token: string) {
  const result = await list({ prefix, limit: 1000, token });
  return (
    await Promise.all(
      result.blobs.map(async (blob) => {
        try {
          const response = await fetch(blob.url, { cache: "no-store" });
          if (!response.ok) return null;
          return { blob, value: (await response.json()) as T };
        } catch {
          return null;
        }
      }),
    )
  ).filter((item): item is NonNullable<typeof item> => item !== null);
}

export async function findListing(datasetId: string, token: string) {
  const rows = await loadJsonBlobs<StoredMarketListing>(LISTING_PREFIX, token);
  return (
    rows.find(
      ({ value }) => `${value.ownerAddress}:${value.manifestBlobName}` === datasetId,
    ) ?? null
  );
}

export async function hasLicense(
  datasetId: string,
  address: string,
  token: string,
) {
  const listing = await findListing(datasetId, token);
  if (!listing) return false;
  if (
    shortCanonicalAddress(listing.value.ownerAddress) ===
    shortCanonicalAddress(address)
  ) {
    return true;
  }
  if (listing.value.manifest.price === 0) return true;
  const rows = await loadJsonBlobs<StoredLicense>(ACTIVITY_PREFIX, token);
  const direct = rows.some(
    ({ value }) =>
      value.type === "license" &&
      value.datasetId === datasetId &&
      shortCanonicalAddress(value.buyerAddress) === shortCanonicalAddress(address),
  );
  if (direct) return true;
  const previousDatasetId = listing.value.manifest.previousDatasetId;
  return Boolean(
    previousDatasetId &&
      listing.value.manifest.license?.updatesIncluded &&
      rows.some(
        ({ value }) =>
          value.type === "license" &&
          value.datasetId === previousDatasetId &&
          shortCanonicalAddress(value.buyerAddress) === shortCanonicalAddress(address),
      ),
  );
}
