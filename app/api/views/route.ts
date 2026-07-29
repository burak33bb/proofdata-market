import { list, put } from "@vercel/blob";
import { findListing } from "../_lib/market-storage";

const VIEW_PREFIX = "proofdata-views/v2/";

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return Response.json({ counted: false });
  const body = (await request.json()) as { datasetId?: string; visitorId?: string };
  const datasetId = String(body.datasetId ?? "");
  const visitorId = String(body.visitorId ?? "");
  if (!datasetId || !/^[a-zA-Z0-9-]{16,80}$/.test(visitorId)) {
    return Response.json({ error: "Invalid view." }, { status: 400 });
  }
  const listing = await findListing(datasetId, token);
  if (!listing) return Response.json({ error: "Dataset not found." }, { status: 404 });
  const markerPath = `${VIEW_PREFIX}${await hash(`${datasetId}:${visitorId}`)}.json`;
  const existing = await list({ prefix: markerPath, limit: 1, token });
  if (existing.blobs.length) return Response.json({ counted: false });

  await put(markerPath, JSON.stringify({ datasetId, createdAt: Date.now() }), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    token,
  });
  const updated = {
    ...listing.value,
    views: ((listing.value as StoredMarketListingWithViews).views ?? 0) + 1,
  };
  await put(listing.blob.pathname, JSON.stringify(updated), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
  return Response.json({ counted: true, views: updated.views });
}

type StoredMarketListingWithViews = { views?: number };
