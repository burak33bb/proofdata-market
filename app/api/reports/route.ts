import { list, put } from "@vercel/blob";
import { canonicalAddress, verifyWalletProof, type WalletProof } from "../_lib/wallet-proof";

const REPORT_PREFIX = "proofdata-reports/v2/";
const LISTING_PREFIX = "proofdata-listings/v2/";

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return Response.json({ error: "Report storage is not connected." }, { status: 503 });
  }

  try {
    const body = (await request.json()) as {
      datasetId?: string;
      reporterAddress?: string;
      reason?: string;
      proof?: WalletProof;
    };
    const datasetId = String(body.datasetId ?? "");
    const reporterAddress = canonicalAddress(String(body.reporterAddress ?? ""));
    const reason = String(body.reason ?? "").trim().slice(0, 120);
    if (!datasetId || !reporterAddress || !reason) {
      return Response.json({ error: "Invalid report." }, { status: 400 });
    }
    const message = `proofdata:reports:create:v1:${datasetId}:${reason}`;
    if (!verifyWalletProof(body.proof, reporterAddress, message)) {
      return Response.json({ error: "Wallet verification failed." }, { status: 401 });
    }

    const listingResult = await list({ prefix: LISTING_PREFIX, limit: 1000, token });
    const listingRow = (
      await Promise.all(
        listingResult.blobs.map(async (blob) => {
          try {
            const response = await fetch(blob.url, { cache: "no-store" });
            if (!response.ok) return null;
            const listing = (await response.json()) as {
              ownerAddress?: string;
              manifestBlobName?: string;
              reports?: number;
              [key: string]: unknown;
            };
            return `${listing.ownerAddress}:${listing.manifestBlobName}` === datasetId
              ? { blob, listing }
              : null;
          } catch {
            return null;
          }
        }),
      )
    ).find((item) => item !== null);
    if (!listingRow) {
      return Response.json({ error: "Listing not found." }, { status: 404 });
    }

    const safeId = `${datasetId}:${reporterAddress}`.replace(/[^a-zA-Z0-9._-]/g, "-");
    const existing = await list({ prefix: `${REPORT_PREFIX}${safeId}.json`, limit: 1, token });
    if (existing.blobs.length) {
      return Response.json({ report: { datasetId, reporterAddress, reason }, duplicate: true });
    }
    const report = { version: 1, datasetId, reporterAddress, reason, createdAt: Date.now() };
    await put(`${REPORT_PREFIX}${safeId}.json`, JSON.stringify(report), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token,
    });
    await put(
      listingRow.blob.pathname,
      JSON.stringify({
        ...listingRow.listing,
        reports: (listingRow.listing.reports ?? 0) + 1,
      }),
      {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        token,
      },
    );
    return Response.json({ report }, { status: 201 });
  } catch (error) {
    console.error("Report creation failed", error);
    return Response.json({ error: "The report could not be submitted." }, { status: 500 });
  }
}
