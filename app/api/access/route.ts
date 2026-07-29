import { list, put } from "@vercel/blob";
import { verifyWalletProof, type WalletProof } from "../_lib/wallet-proof";
import { findListing, hasLicense } from "../_lib/market-storage";
import { unwrapDatasetKey, wrapDatasetKey } from "../_lib/storage-crypto";

const ACCESS_PREFIX = "proofdata-access/v2/";

function safeKeyId(value: string) {
  return /^[a-zA-Z0-9_-]{16,100}$/.test(value);
}

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return Response.json({ error: "Secure delivery is not connected." }, { status: 503 });
  }

  try {
    const body = (await request.json()) as {
      action?: "register" | "unlock";
      datasetId?: string;
      keyId?: string;
      keyBase64?: string;
      address?: string;
      proof?: WalletProof;
    };
    const action = body.action;
    const datasetId = String(body.datasetId ?? "");
    const keyId = String(body.keyId ?? "");
    const address = String(body.address ?? "");
    if (!action || !datasetId || !safeKeyId(keyId) || !address) {
      return Response.json({ error: "Invalid secure-delivery request." }, { status: 400 });
    }
    const listing = await findListing(datasetId, token);
    if (!listing) {
      return Response.json({ error: "Dataset listing not found." }, { status: 404 });
    }

    if (action === "register") {
      const message = `proofdata:access:register:v1:${datasetId}:${keyId}`;
      if (
        !verifyWalletProof(body.proof, listing.value.ownerAddress, message) ||
        !body.keyBase64 ||
        Buffer.from(body.keyBase64, "base64").length !== 32
      ) {
        return Response.json({ error: "Publisher verification failed." }, { status: 401 });
      }
      const wrapped = await wrapDatasetKey(body.keyBase64, datasetId, token);
      await put(
        `${ACCESS_PREFIX}${keyId}.json`,
        JSON.stringify({
          version: 1,
          datasetId,
          keyId,
          ownerAddress: listing.value.ownerAddress,
          wrapped,
          createdAt: Date.now(),
        }),
        {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: "application/json",
          token,
        },
      );
      return Response.json({ registered: true }, { status: 201 });
    }

    const message = `proofdata:access:unlock:v1:${datasetId}:${keyId}`;
    if (!verifyWalletProof(body.proof, address, message)) {
      return Response.json({ error: "Wallet verification failed." }, { status: 401 });
    }
    if (!(await hasLicense(datasetId, address, token))) {
      return Response.json({ error: "A valid dataset license is required." }, { status: 403 });
    }
    const result = await list({ prefix: `${ACCESS_PREFIX}${keyId}.json`, limit: 1, token });
    const blob = result.blobs[0];
    if (!blob) {
      return Response.json({ error: "The decryption key is not available." }, { status: 404 });
    }
    const envelopeResponse = await fetch(blob.url, { cache: "no-store" });
    const envelope = (await envelopeResponse.json()) as {
      datasetId: string;
      wrapped: { iv: string; ciphertext: string };
    };
    if (envelope.datasetId !== datasetId) {
      return Response.json({ error: "Secure-delivery record mismatch." }, { status: 409 });
    }
    const keyBase64 = await unwrapDatasetKey(envelope.wrapped, datasetId, token);
    return Response.json({ keyBase64 });
  } catch (error) {
    console.error("Secure delivery failed", error);
    return Response.json({ error: "Secure delivery could not be completed." }, { status: 500 });
  }
}
