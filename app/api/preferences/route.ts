import { list, put } from "@vercel/blob";
import { canonicalAddress, verifyWalletProof, type WalletProof } from "../_lib/wallet-proof";

const PREFIX = "proofdata-preferences/v2/";

type Preferences = {
  version: 1;
  address: string;
  favorites: string[];
  readNotificationsAt: number;
  updatedAt: number;
};

function pathFor(address: string) {
  return `${PREFIX}${address.replace(/^0x/, "")}.json`;
}

async function load(address: string, token: string): Promise<Preferences> {
  const result = await list({ prefix: pathFor(address), limit: 1, token });
  const blob = result.blobs[0];
  if (blob) {
    try {
      return (await (await fetch(blob.url, { cache: "no-store" })).json()) as Preferences;
    } catch {
      // Fall through to an empty preference record.
    }
  }
  return { version: 1, address, favorites: [], readNotificationsAt: 0, updatedAt: 0 };
}

export async function GET(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const address = canonicalAddress(new URL(request.url).searchParams.get("address") ?? "");
  if (!token || !address) return Response.json({ preferences: null });
  return Response.json({ preferences: await load(address, token) });
}

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return Response.json({ error: "Preferences are unavailable." }, { status: 503 });
  const body = (await request.json()) as {
    address?: string;
    action?: "favorite" | "read-notifications";
    datasetId?: string;
    proof?: WalletProof;
  };
  const address = canonicalAddress(String(body.address ?? ""));
  const action = body.action;
  const datasetId = String(body.datasetId ?? "");
  if (!address || !action || (action === "favorite" && !datasetId)) {
    return Response.json({ error: "Invalid preference action." }, { status: 400 });
  }
  const message = `proofdata:preferences:${action}:v1:${datasetId}`;
  if (!verifyWalletProof(body.proof, address, message)) {
    return Response.json({ error: "Wallet verification failed." }, { status: 401 });
  }
  const current = await load(address, token);
  const favorites =
    action === "favorite"
      ? current.favorites.includes(datasetId)
        ? current.favorites.filter((item) => item !== datasetId)
        : [...current.favorites, datasetId].slice(-100)
      : current.favorites;
  const updated: Preferences = {
    ...current,
    favorites,
    readNotificationsAt:
      action === "read-notifications" ? Date.now() : current.readNotificationsAt,
    updatedAt: Date.now(),
  };
  await put(pathFor(address), JSON.stringify(updated), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
  return Response.json({ preferences: updated });
}
