import { put } from "@vercel/blob";
import { verifyWalletProof, type WalletProof } from "../_lib/wallet-proof";
import { hasLicense, loadJsonBlobs } from "../_lib/market-storage";

const REVIEW_PREFIX = "proofdata-reviews/v2/";

type Review = {
  version: 1;
  datasetId: string;
  reviewerAddress: string;
  score: number;
  comment: string;
  createdAt: number;
};

export async function GET() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return Response.json({ reviews: [] });
  const rows = await loadJsonBlobs<Review>(REVIEW_PREFIX, token);
  return Response.json({ reviews: rows.map(({ value }) => value) });
}

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return Response.json({ error: "Reviews are unavailable." }, { status: 503 });
  const body = (await request.json()) as {
    datasetId?: string;
    reviewerAddress?: string;
    score?: number;
    comment?: string;
    proof?: WalletProof;
  };
  const datasetId = String(body.datasetId ?? "");
  const reviewerAddress = String(body.reviewerAddress ?? "");
  const score = Number(body.score);
  const comment = String(body.comment ?? "").trim().slice(0, 500);
  if (
    !datasetId ||
    !reviewerAddress ||
    !Number.isInteger(score) ||
    score < 1 ||
    score > 5 ||
    !comment ||
    !(await hasLicense(datasetId, reviewerAddress, token))
  ) {
    return Response.json({ error: "Only licensed buyers can submit a valid review." }, { status: 400 });
  }
  const message = `proofdata:reviews:create:v1:${datasetId}:${score}`;
  if (!verifyWalletProof(body.proof, reviewerAddress, message)) {
    return Response.json({ error: "Reviewer verification failed." }, { status: 401 });
  }
  const safeAddress = reviewerAddress.toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeDataset = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(datasetId),
  );
  const datasetHash = Array.from(new Uint8Array(safeDataset), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const review: Review = {
    version: 1,
    datasetId,
    reviewerAddress,
    score,
    comment,
    createdAt: Date.now(),
  };
  await put(`${REVIEW_PREFIX}${datasetHash}-${safeAddress}.json`, JSON.stringify(review), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
  return Response.json({ review }, { status: 201 });
}
