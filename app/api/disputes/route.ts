import { list, put } from "@vercel/blob";
import { verifyWalletProof, type WalletProof } from "../_lib/wallet-proof";
import { findListing, hasLicense, loadJsonBlobs } from "../_lib/market-storage";

const DISPUTE_PREFIX = "proofdata-disputes/v2/";

type Dispute = {
  version: 1;
  id: string;
  datasetId: string;
  buyerAddress: string;
  sellerAddress: string;
  reason: string;
  details: string;
  status: "open" | "seller-responded" | "resolved";
  sellerResponse?: string;
  createdAt: number;
  updatedAt: number;
};

export async function GET(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return Response.json({ error: "Disputes are unavailable." }, { status: 503 });
  const address = new URL(request.url).searchParams.get("address") ?? "";
  const rows = await loadJsonBlobs<Dispute>(DISPUTE_PREFIX, token);
  return Response.json({
    disputes: rows
      .map(({ value }) => value)
      .filter(
        (item) =>
          !address ||
          item.buyerAddress.toLowerCase() === address.toLowerCase() ||
          item.sellerAddress.toLowerCase() === address.toLowerCase(),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt),
  });
}

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return Response.json({ error: "Disputes are unavailable." }, { status: 503 });
  try {
    const body = (await request.json()) as {
      action?: "create" | "respond";
      id?: string;
      datasetId?: string;
      address?: string;
      reason?: string;
      details?: string;
      response?: string;
      proof?: WalletProof;
    };
    const address = String(body.address ?? "");
    if (body.action === "create") {
      const datasetId = String(body.datasetId ?? "");
      const reason = String(body.reason ?? "").trim().slice(0, 80);
      const details = String(body.details ?? "").trim().slice(0, 1000);
      const listing = await findListing(datasetId, token);
      if (!listing || !reason || !details || !(await hasLicense(datasetId, address, token))) {
        return Response.json({ error: "A purchased dataset and details are required." }, { status: 400 });
      }
      const message = `proofdata:disputes:create:v1:${datasetId}:${reason}`;
      if (!verifyWalletProof(body.proof, address, message)) {
        return Response.json({ error: "Buyer verification failed." }, { status: 401 });
      }
      const id = crypto.randomUUID();
      const dispute: Dispute = {
        version: 1,
        id,
        datasetId,
        buyerAddress: address,
        sellerAddress: listing.value.ownerAddress,
        reason,
        details,
        status: "open",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await put(`${DISPUTE_PREFIX}${id}.json`, JSON.stringify(dispute), {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json",
        token,
      });
      return Response.json({ dispute }, { status: 201 });
    }

    if (body.action === "respond" && body.id) {
      const result = await list({ prefix: `${DISPUTE_PREFIX}${body.id}.json`, limit: 1, token });
      const blob = result.blobs[0];
      if (!blob) return Response.json({ error: "Dispute not found." }, { status: 404 });
      const current = (await (await fetch(blob.url, { cache: "no-store" })).json()) as Dispute;
      const response = String(body.response ?? "").trim().slice(0, 1000);
      const message = `proofdata:disputes:respond:v1:${current.id}:${response}`;
      if (!response || !verifyWalletProof(body.proof, current.sellerAddress, message)) {
        return Response.json({ error: "Seller verification failed." }, { status: 401 });
      }
      const updated: Dispute = {
        ...current,
        sellerResponse: response,
        status: "seller-responded",
        updatedAt: Date.now(),
      };
      await put(blob.pathname, JSON.stringify(updated), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        token,
      });
      return Response.json({ dispute: updated });
    }
    return Response.json({ error: "Invalid dispute action." }, { status: 400 });
  } catch (error) {
    console.error("Dispute action failed", error);
    return Response.json({ error: "The dispute action failed." }, { status: 500 });
  }
}
