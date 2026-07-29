"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { localeOptions, messages, type CopyKey, type Locale } from "./i18n";

const SHELBY_USD_METADATA =
  "0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1";
const SHELBY_API_KEY = process.env.NEXT_PUBLIC_SHELBY_API_KEY ?? "";
const aptosClient = new Aptos(new AptosConfig({ network: Network.SHELBYNET }));

function shortAddress(address?: string) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function sameAddress(left?: string, right?: string) {
  if (!left || !right) return false;
  const normalize = (value: string) =>
    `0x${value.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  return normalize(left) === normalize(right);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function trustScore(dataset: Dataset, sales: number, reports = 0, reviewAverage = 0) {
  let score = 45;
  if (dataset.encryption) score += 20;
  if (dataset.source !== "Not specified" && dataset.source.trim()) score += 8;
  if (dataset.useCases.length) score += 7;
  if (dataset.language !== "Unspecified") score += 4;
  if (dataset.license) score += 6;
  score += Math.min(10, sales * 2);
  if (reviewAverage) score += Math.round((reviewAverage / 5) * 10);
  score -= Math.min(30, reports * 10);
  return Math.max(0, Math.min(100, score));
}

function errorDetails(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    for (const key of ["message", "reason", "error", "description", "code"]) {
      const detail = value[key];
      if (typeof detail === "string" && detail.trim()) return detail.trim();
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Fall through to the user-friendly default below.
    }
  }
  return "";
}

function publishingError(error: unknown, phase: string, locale: Locale) {
  const detail = errorDetails(error);
  const normalized = detail.toLowerCase();
  const turkish = locale === "tr";

  if (
    normalized.includes("insufficient_balance_for_transaction_fee") ||
    normalized.includes("not enough apt") ||
    normalized.includes("insufficient gas")
  ) {
    return turkish
      ? "Cüzdanında işlem ücreti için yeterli APT yok. Faucet’ten APT alıp tekrar dene."
      : "Your wallet needs APT for the transaction fee. Fund it from the Faucet and retry.";
  }
  if (
    normalized.includes("eblob_write_insufficient_funds") ||
    normalized.includes("insufficient funds") ||
    normalized.includes("shelbyusd")
  ) {
    return turkish
      ? "Cüzdanında yükleme için yeterli ShelbyUSD yok. Faucet’ten ShelbyUSD alıp tekrar dene."
      : "Your wallet needs ShelbyUSD for storage. Fund it from the Faucet and retry.";
  }
  if (normalized.includes("wrong_wallet_network")) {
    return turkish
      ? "Petra şu anda ShelbyNet’te değil. Petra → Settings → Network bölümünden eklediğin ShelbyNet ağını seç."
      : "Petra is not on ShelbyNet. Open Petra → Settings → Network and select your custom ShelbyNet network.";
  }
  if (normalized.includes("reject") || normalized.includes("cancel") || normalized.includes("denied")) {
    return turkish
      ? "Petra’daki işlem onaylanmadı. Tekrar dene ve cüzdandaki Onayla düğmesine bas."
      : "The Petra approval was not completed. Retry and approve the request in your wallet.";
  }
  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("cors")
  ) {
    return turkish
      ? "ShelbyNet servisine ulaşılamadı. İnternetini kontrol edip birkaç saniye sonra tekrar dene."
      : "ShelbyNet could not be reached. Check your connection and retry in a few seconds.";
  }

  const fallback = turkish
    ? `${phase} adımında işlem tamamlanamadı. Petra’nın ShelbyNet ağında olduğunu ve APT ile ShelbyUSD bakiyeni kontrol et.`
    : `The ${phase} step could not finish. Confirm Petra is on ShelbyNet and that you have both APT and ShelbyUSD.`;
  return detail ? `${fallback} Hata: ${detail}` : fallback;
}

type View = "explore" | "studio" | "activity";
type DatasetPreview =
  | { kind: "table"; headers: string[]; rows: string[][]; rowCount?: number }
  | { kind: "text"; text: string }
  | { kind: "image"; dataUrl?: string }
  | { kind: "audio" | "video" | "pdf" | "file" };

type DatasetLicense = {
  type: string;
  commercialUse: boolean;
  modelTraining: boolean;
  redistribution: boolean;
  duration: string;
  updatesIncluded: boolean;
};

type DatasetEncryption = {
  algorithm: "AES-GCM";
  iv: string;
  keyId: string;
  originalSize: number;
};

type Dataset = {
  id: string;
  name: string;
  description: string;
  ownerAddress: string;
  owner: string;
  ownerMark: string;
  category: string;
  format: string;
  rows: string;
  recordCount: number;
  sizeBytes: number;
  size: string;
  price: number;
  downloads: string;
  verified: boolean;
  freshness: string;
  accent: string;
  tags: string[];
  root: string;
  fullRoot: string;
  blobName: string;
  mimeType: string;
  preview: DatasetPreview;
  createdAt: number;
  status: "active" | "inactive";
  version: number;
  revisions: ListingRevision[];
  originalFileName: string;
  source: string;
  geography: string;
  language: string;
  collectedFrom: string;
  collectedTo: string;
  updateFrequency: string;
  labeled: boolean;
  containsPersonalData: boolean;
  useCases: string[];
  license: DatasetLicense;
  encryption?: DatasetEncryption;
  reports: number;
  views: number;
  previousDatasetId?: string;
};

type ListingRevision = {
  version: number;
  name: string;
  description: string;
  category: string;
  price: number;
  updatedAt: number;
};

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
  license?: DatasetLicense;
  encryption?: DatasetEncryption;
  previousDatasetId?: string;
};

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
  license?: DatasetLicense;
};

type Dispute = {
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

type DatasetReview = {
  datasetId: string;
  reviewerAddress: string;
  score: number;
  comment: string;
  createdAt: number;
};

const MANIFEST_PREFIX = "proofdata-market/v2/";

function shelbyBlobUrl(owner: string, blobName: string) {
  const path = blobName.split("/").map(encodeURIComponent).join("/");
  return `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/${encodeURIComponent(owner)}/${path}`;
}

function parseDelimited(text: string, delimiter: string) {
  const parsed: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) parsed.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) parsed.push(row);
  return parsed;
}

async function buildPreview(file: File): Promise<DatasetPreview> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.type.startsWith("image/")) {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 480 / bitmap.width, 320 / bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      return dataUrl.length <= 210_000 ? { kind: "image", dataUrl } : { kind: "image" };
    } catch {
      return { kind: "image" };
    }
  }
  if (file.type.startsWith("audio/")) return { kind: "audio" };
  if (file.type.startsWith("video/")) return { kind: "video" };
  if (file.type === "application/pdf" || extension === "pdf") return { kind: "pdf" };

  if (["csv", "tsv"].includes(extension) || file.type === "text/csv") {
    const text = await file.slice(0, 2 * 1024 * 1024).text();
    const delimiter = extension === "tsv" ? "\t" : ((text.split("\n")[0]?.match(/;/g)?.length ?? 0) > (text.split("\n")[0]?.match(/,/g)?.length ?? 0) ? ";" : ",");
    const parsed = parseDelimited(text, delimiter);
    const headers = (parsed[0] ?? []).slice(0, 8).map((value, index) => value.trim() || `Column ${index + 1}`);
    const rows = parsed.slice(1, 6).map((values) => headers.map((_, index) => values[index]?.trim() ?? ""));
    return {
      kind: "table",
      headers,
      rows,
      rowCount: file.size <= 2 * 1024 * 1024 ? Math.max(0, parsed.length - 1) : undefined,
    };
  }

  if (
    file.type.startsWith("text/") ||
    ["json", "jsonl", "ndjson", "txt", "md", "xml", "yaml", "yml"].includes(extension)
  ) {
    const raw = await file.slice(0, 32 * 1024).text();
    let text = raw;
    if (extension === "json") {
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        // A partial or invalid JSON file is still safely previewed as text.
      }
    }
    return { kind: "text", text: text.slice(0, 5000) };
  }

  return { kind: "file" };
}

function manifestToDataset(
  manifest: ListingManifest,
  ownerAddress: string,
  manifestBlobName: string,
  listing?: {
    status?: "active" | "inactive";
    version?: number;
    revisions?: ListingRevision[];
    updatedAt?: number;
    reports?: number;
    views?: number;
  },
): Dataset | null {
  if (
    manifest?.version !== 1 ||
    typeof manifest.name !== "string" ||
    !manifest.name.trim() ||
    typeof manifest.blobName !== "string" ||
    !manifest.blobName.startsWith("proofdata/") ||
    typeof manifest.price !== "number" ||
    !Number.isFinite(manifest.price) ||
    manifest.price < 0 ||
    typeof manifest.sizeBytes !== "number" ||
    manifest.sizeBytes < 0 ||
    typeof manifest.dataRoot !== "string" ||
    !manifest.preview ||
    typeof manifest.preview.kind !== "string"
  ) {
    return null;
  }

  const previewKinds = ["table", "text", "image", "audio", "video", "pdf", "file"];
  if (!previewKinds.includes(manifest.preview.kind)) return null;
  const format = String(manifest.format || "FILE").slice(0, 12).toUpperCase();
  const root = manifest.dataRoot;
  const rowCount =
    manifest.preview.kind === "table" && typeof manifest.preview.rowCount === "number"
      ? manifest.preview.rowCount
      : 1;

  return {
    id: `${ownerAddress}:${manifestBlobName}`,
    name: manifest.name.trim().slice(0, 120),
    description: String(manifest.description || "Dataset published on ShelbyNet.").slice(0, 500),
    ownerAddress,
    owner: shortAddress(ownerAddress),
    ownerMark: ownerAddress.replace(/^0x/, "").slice(0, 2).toUpperCase(),
    category: String(manifest.category || "Onchain"),
    format,
    rows: rowCount.toLocaleString(),
    recordCount: rowCount,
    sizeBytes: manifest.sizeBytes,
    size: formatFileSize(manifest.sizeBytes),
    price: manifest.price,
    downloads: "—",
    verified: true,
    freshness: "NEW",
    accent: "lime",
    tags: [format.toLowerCase(), "shelbynet", "verified"],
    root: root.length > 20 ? `${root.slice(0, 10)}…${root.slice(-6)}` : root,
    fullRoot: root,
    blobName: manifest.blobName,
    mimeType: String(manifest.mimeType || "application/octet-stream"),
    preview: manifest.preview,
    createdAt: listing?.updatedAt ?? manifest.createdAt,
    status: listing?.status ?? "active",
    version: listing?.version ?? 1,
    revisions:
      listing?.revisions?.length
        ? listing.revisions
        : [
            {
              version: 1,
              name: manifest.name,
              description: manifest.description,
              category: manifest.category,
              price: manifest.price,
              updatedAt: manifest.createdAt,
            },
          ],
    originalFileName: String(manifest.originalFileName || manifest.blobName.split("/").pop() || "dataset"),
    source: String(manifest.source || "Not specified"),
    geography: String(manifest.geography || "Global"),
    language: String(manifest.language || "Unspecified"),
    collectedFrom: String(manifest.collectedFrom || ""),
    collectedTo: String(manifest.collectedTo || ""),
    updateFrequency: String(manifest.updateFrequency || "One-time"),
    labeled: Boolean(manifest.labeled),
    containsPersonalData: Boolean(manifest.containsPersonalData),
    useCases: Array.isArray(manifest.useCases) ? manifest.useCases.slice(0, 8) : [],
    license: manifest.license ?? {
      type: "Commercial",
      commercialUse: true,
      modelTraining: true,
      redistribution: false,
      duration: "Perpetual",
      updatesIncluded: true,
    },
    encryption: manifest.encryption,
    reports: listing?.reports ?? 0,
    views: listing?.views ?? 0,
    previousDatasetId: manifest.previousDatasetId,
  };
}

function DatasetPreviewPanel({ dataset, locale }: { dataset: Dataset; locale: Locale }) {
  const source = shelbyBlobUrl(dataset.ownerAddress, dataset.blobName);
  const preview = dataset.preview;
  const label = locale === "tr" ? "Gerçek dosya önizlemesi" : "Actual file preview";

  if (preview.kind === "image") {
    if (preview.dataUrl) {
      return <div className="media-preview"><img src={preview.dataUrl} alt={`${dataset.name} preview`} /></div>;
    }
    if (!dataset.encryption) {
      return <div className="media-preview"><img src={source} alt={`${dataset.name} preview`} /></div>;
    }
  }
  if (preview.kind === "audio") {
    if (dataset.encryption) return <div className="preview-empty"><strong>AUDIO</strong><span>{locale === "tr" ? "Güvenli ses dosyası satın alma sonrası açılır." : "Secure audio unlocks after purchase."}</span></div>;
    return <div className="media-preview compact-media"><audio controls preload="metadata" src={source} /></div>;
  }
  if (preview.kind === "video") {
    if (dataset.encryption) return <div className="preview-empty"><strong>VIDEO</strong><span>{locale === "tr" ? "Güvenli video satın alma sonrası açılır." : "Secure video unlocks after purchase."}</span></div>;
    return <div className="media-preview"><video controls preload="metadata" src={source} /></div>;
  }
  if (preview.kind === "pdf") {
    if (dataset.encryption) return <div className="preview-empty"><strong>PDF</strong><span>{locale === "tr" ? "Şifreli PDF satın alma sonrası açılır." : "The encrypted PDF unlocks after purchase."}</span></div>;
    return <div className="media-preview pdf-preview"><iframe src={source} title={`${dataset.name} PDF preview`} /></div>;
  }
  if (preview.kind === "table") {
    if (!preview.headers.length || !preview.rows.length) {
      return <div className="preview-empty">{locale === "tr" ? "Bu tabloda önizlenecek satır yok." : "This table has no previewable rows."}</div>;
    }
    return (
      <div className="sample-table">
        <table>
          <thead><tr>{preview.headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead>
          <tbody>
            {preview.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{preview.headers.map((_, cellIndex) => <td key={cellIndex}>{row[cellIndex] ?? ""}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (preview.kind === "text") {
    return <pre className="text-preview">{preview.text || (locale === "tr" ? "Dosya boş." : "The file is empty.")}</pre>;
  }
  return (
    <div className="preview-empty">
      <strong>{dataset.format}</strong>
      <span>{locale === "tr" ? "Bu dosya türü tarayıcıda güvenli biçimde önizlenemiyor." : "This file type cannot be safely previewed in the browser."}</span>
      <small>{label} · {dataset.size}</small>
    </div>
  );
}


function DataGlyph({ accent }: { accent: string }) {
  return (
    <div className={`data-glyph ${accent}`} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <i />
      <b />
    </div>
  );
}

function Metric({ value, label, hint }: { value: string; label: string; hint: string }) {
  return (
    <div className="metric">
      <div className="metric-top">
        <strong>{value}</strong>
        <span>{hint}</span>
      </div>
      <p>{label}</p>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("explore");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All datasets");
  const [sortBy, setSortBy] = useState<"newest" | "price-low" | "price-high" | "size" | "trust" | "popular">("newest");
  const [studioTab, setStudioTab] = useState<"listings" | "purchases" | "disputes">("listings");
  const [selected, setSelected] = useState<Dataset | null>(null);
  const [purchase, setPurchase] = useState<Dataset | null>(null);
  const [manageListing, setManageListing] = useState<Dataset | null>(null);
  const [manageName, setManageName] = useState("");
  const [manageDescription, setManageDescription] = useState("");
  const [manageCategory, setManageCategory] = useState("Onchain");
  const [managePrice, setManagePrice] = useState("");
  const [manageBusy, setManageBusy] = useState(false);
  const [manageStatus, setManageStatus] = useState("");
  const [reportStatus, setReportStatus] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [walletStatus, setWalletStatus] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [transactionBusy, setTransactionBusy] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [listingName, setListingName] = useState("");
  const [listingDescription, setListingDescription] = useState("");
  const [listingCategory, setListingCategory] = useState("Onchain");
  const [listingPrice, setListingPrice] = useState("");
  const [listingSource, setListingSource] = useState("");
  const [listingGeography, setListingGeography] = useState("Global");
  const [listingLanguage, setListingLanguage] = useState("English");
  const [listingCollectedFrom, setListingCollectedFrom] = useState("");
  const [listingCollectedTo, setListingCollectedTo] = useState("");
  const [listingUpdateFrequency, setListingUpdateFrequency] = useState("One-time");
  const [listingLabeled, setListingLabeled] = useState(false);
  const [listingContainsPii, setListingContainsPii] = useState(false);
  const [listingUseCases, setListingUseCases] = useState("");
  const [licenseType, setLicenseType] = useState("Commercial");
  const [licenseCommercial, setLicenseCommercial] = useState(true);
  const [licenseTraining, setLicenseTraining] = useState(true);
  const [licenseRedistribution, setLicenseRedistribution] = useState(false);
  const [licenseDuration, setLicenseDuration] = useState("Perpetual");
  const [licenseUpdates, setLicenseUpdates] = useState(true);
  const [previousDatasetId, setPreviousDatasetId] = useState("");
  const [publishedDatasets, setPublishedDatasets] = useState<Dataset[]>([]);
  const [saleActivities, setSaleActivities] = useState<SaleActivity[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [disputeDataset, setDisputeDataset] = useState<Dataset | null>(null);
  const [disputeReason, setDisputeReason] = useState("Dataset differs from description");
  const [disputeDetails, setDisputeDetails] = useState("");
  const [disputeStatus, setDisputeStatus] = useState("");
  const [respondingDisputeId, setRespondingDisputeId] = useState("");
  const [sellerResponse, setSellerResponse] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [readNotificationsAt, setReadNotificationsAt] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [reviews, setReviews] = useState<DatasetReview[]>([]);
  const [reviewScore, setReviewScore] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadTransactionHash, setUploadTransactionHash] = useState("");
  const [locale, setLocale] = useState<Locale>("en");
  const c = messages[locale];
  const {
    account,
    connected,
    connect,
    disconnect,
    wallets,
    network,
    changeNetwork,
    signMessage,
    signAndSubmitTransaction,
  } = useWallet();

  useEffect(() => {
    const savedLocale = window.localStorage.getItem("proofdata-locale") as Locale | null;
    delete document.documentElement.dataset.theme;
    window.localStorage.removeItem("proofdata-theme");
    if (savedLocale && localeOptions.some((option) => option.code === savedLocale)) {
      setLocale(savedLocale);
    } else {
      const browserLocale = navigator.language.slice(0, 2) as Locale;
      if (localeOptions.some((option) => option.code === browserLocale)) setLocale(browserLocale);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem("proofdata-locale", locale);
  }, [locale]);

  useEffect(() => {
    let cancelled = false;

    async function loadMarketplace() {
      setMarketLoading(true);
      setMarketError("");
      try {
        const [response, activityResponse, reviewsResponse] = await Promise.all([
          fetch("/api/listings", { cache: "no-store" }),
          fetch("/api/activity", { cache: "no-store" }).catch(() => null),
          fetch("/api/reviews", { cache: "no-store" }).catch(() => null),
        ]);
        if (!response.ok) throw new Error(`MARKETPLACE_HTTP_${response.status}`);
        const payload = (await response.json()) as {
          listings?: Array<{
            ownerAddress: string;
            manifestBlobName: string;
            manifest: ListingManifest;
            status?: "active" | "inactive";
            version?: number;
            revisions?: ListingRevision[];
            updatedAt?: number;
            reports?: number;
            views?: number;
          }>;
        };
        const loaded = (payload.listings ?? []).map((item) =>
          manifestToDataset(
            item.manifest,
            item.ownerAddress,
            item.manifestBlobName,
            item,
          ),
        );
        if (!cancelled) {
          const unique = new Map<string, Dataset>();
          loaded.forEach((dataset) => {
            if (dataset && !unique.has(dataset.id)) unique.set(dataset.id, dataset);
          });
          setPublishedDatasets([...unique.values()]);
          if (activityResponse?.ok) {
            const activityPayload = (await activityResponse.json()) as {
              activities?: SaleActivity[];
            };
            setSaleActivities(activityPayload.activities ?? []);
          }
          if (reviewsResponse?.ok) {
            const reviewsPayload = (await reviewsResponse.json()) as {
              reviews?: DatasetReview[];
            };
            setReviews(reviewsPayload.reviews ?? []);
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Marketplace loading failed", error);
          const preferredLocale =
            window.localStorage.getItem("proofdata-locale") === "tr" ? "tr" : locale;
          setMarketError(
            preferredLocale === "tr"
              ? "İlanlar şu anda alınamadı. Biraz sonra yeniden dene."
              : "Listings could not be loaded. Please retry shortly.",
          );
        }
      } finally {
        if (!cancelled) setMarketLoading(false);
      }
    }

    void loadMarketplace();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (connected) {
      setWalletStatus("");
      if (uploadFile) setUploadOpen(true);
    }
  }, [connected, uploadFile]);

  const categoryLabel = (item: string) =>
    item === "All datasets" ? c.all : c[item as CopyKey] ?? item;
  const reviewAverage = (datasetId: string) => {
    const matches = reviews.filter((review) => review.datasetId === datasetId);
    return matches.length
      ? matches.reduce((total, review) => total + review.score, 0) / matches.length
      : 0;
  };

  const filtered = useMemo(() => {
    const text = query.toLowerCase();
    const rows = publishedDatasets.filter((item) => {
      const matchesText =
        !text ||
        item.name.toLowerCase().includes(text) ||
        item.description.toLowerCase().includes(text) ||
        item.tags.some((tag) => tag.includes(text));
      const matchesCategory =
        category === "All datasets" || item.category === category;
      return item.status === "active" && matchesText && matchesCategory;
    });
    return rows.sort((left, right) => {
      if (sortBy === "price-low") return left.price - right.price;
      if (sortBy === "price-high") return right.price - left.price;
      if (sortBy === "size") return right.sizeBytes - left.sizeBytes;
      if (sortBy === "popular") return right.views - left.views;
      if (sortBy === "trust") {
        const leftSales = saleActivities.filter((sale) => sale.datasetId === left.id).length;
        const rightSales = saleActivities.filter((sale) => sale.datasetId === right.id).length;
        return trustScore(right, rightSales, right.reports, reviewAverage(right.id)) - trustScore(left, leftSales, left.reports, reviewAverage(left.id));
      }
      return right.createdAt - left.createdAt;
    });
  }, [query, category, sortBy, publishedDatasets, saleActivities, reviews]);

  const activeDatasets = publishedDatasets.filter((item) => item.status === "active");
  const verifiedBytes = activeDatasets.reduce((total, item) => total + item.sizeBytes, 0);
  const agentReadyRecords = activeDatasets.reduce(
    (total, item) => total + item.recordCount,
    0,
  );
  const verifiedCount = activeDatasets.filter((item) => item.verified).length;
  const latestDataset = activeDatasets[0] ?? null;
  const integrityRate = activeDatasets.length
    ? Math.round((verifiedCount / activeDatasets.length) * 100)
    : 0;
  const activityFeed = useMemo(
    () =>
      [
        ...publishedDatasets.map((dataset) => ({
          id: `publish:${dataset.id}`,
          name: dataset.name,
          action:
            dataset.status === "active"
              ? (locale === "tr" ? "Veri seti yayımlandı" : "Dataset published")
              : (locale === "tr" ? "İlan satıştan kaldırıldı" : "Listing delisted"),
          time: new Date(dataset.createdAt).toLocaleString(locale),
          value: dataset.size,
          transactionHash: "",
          createdAt: dataset.createdAt,
        })),
        ...saleActivities.map((sale) => ({
          id: `license:${sale.transactionHash}`,
          name: sale.datasetName,
          action: locale === "tr" ? "Lisans satın alındı" : "Dataset licensed",
          time: new Date(sale.createdAt).toLocaleString(locale),
          value: `${sale.price} SUSD`,
          transactionHash: sale.transactionHash,
          createdAt: sale.createdAt,
        })),
      ].sort((left, right) => right.createdAt - left.createdAt),
    [publishedDatasets, saleActivities, locale],
  );
  const accountAddress = account?.address.toString() ?? "";
  useEffect(() => {
    if (!accountAddress) {
      setFavorites([]);
      setDisputes([]);
      setReadNotificationsAt(0);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch(`/api/preferences?address=${encodeURIComponent(accountAddress)}`, {
        cache: "no-store",
      }).then((response) => response.json()),
      fetch(`/api/disputes?address=${encodeURIComponent(accountAddress)}`, {
        cache: "no-store",
      }).then((response) => response.json()),
    ])
      .then(([preferencesPayload, disputesPayload]) => {
        if (cancelled) return;
        setFavorites(preferencesPayload.preferences?.favorites ?? []);
        setReadNotificationsAt(
          preferencesPayload.preferences?.readNotificationsAt ?? 0,
        );
        setDisputes(disputesPayload.disputes ?? []);
      })
      .catch(() => {
        // Marketplace browsing remains available if personal data cannot load.
      });
    return () => {
      cancelled = true;
    };
  }, [accountAddress]);
  const ownedDatasets = publishedDatasets.filter((item) =>
    sameAddress(item.ownerAddress, accountAddress),
  );
  const purchasedLicenses = saleActivities.filter((item) =>
    sameAddress(item.buyerAddress, accountAddress),
  );
  const sellerSales = saleActivities.filter((item) =>
    sameAddress(item.sellerAddress, accountAddress),
  );
  const lifetimeEarnings = sellerSales.reduce((total, item) => total + item.price, 0);
  const notifications = [
    ...sellerSales.map((sale) => ({
      id: `sale:${sale.transactionHash}`,
      title: locale === "tr" ? "Yeni satış" : "New sale",
      body: `${sale.datasetName} · +${sale.price} SUSD`,
      createdAt: sale.createdAt,
    })),
    ...disputes.map((item) => ({
      id: `dispute:${item.id}:${item.updatedAt}`,
      title:
        item.status === "seller-responded"
          ? (locale === "tr" ? "Satıcı yanıt verdi" : "Seller responded")
          : (locale === "tr" ? "Yeni sorun talebi" : "New issue request"),
      body: item.reason,
      createdAt: item.updatedAt,
    })),
    ...favorites
      .map((id) => publishedDatasets.find((dataset) => dataset.id === id))
      .filter((dataset): dataset is Dataset => Boolean(dataset))
      .map((dataset) => ({
        id: `favorite-update:${dataset.id}:${dataset.version}`,
        title: locale === "tr" ? "Favori ilan güncellendi" : "Favorite listing updated",
        body: `${dataset.name} · v${dataset.version} · ${dataset.price} SUSD`,
        createdAt: dataset.createdAt,
      })),
    ...purchasedLicenses
      .map((license) => {
        const dataset =
          publishedDatasets.find(
            (item) =>
              item.previousDatasetId === license.datasetId &&
              item.license.updatesIncluded,
          ) ?? publishedDatasets.find((item) => item.id === license.datasetId);
        return dataset && dataset.createdAt > license.createdAt
          ? {
              id: `licensed-update:${dataset.id}:${dataset.version}`,
              title: locale === "tr" ? "Lisanslı veri güncellendi" : "Licensed data updated",
              body: `${dataset.name} · v${dataset.version}`,
              createdAt: dataset.createdAt,
            }
          : null;
      })
      .filter((item): item is { id: string; title: string; body: string; createdAt: number } => item !== null),
  ].sort((left, right) => right.createdAt - left.createdAt);
  const unreadNotifications = notifications.filter(
    (item) => item.createdAt > readNotificationsAt,
  ).length;

  const hasLicense = (dataset: Dataset) =>
    dataset.price === 0 ||
    sameAddress(dataset.ownerAddress, accountAddress) ||
    purchasedLicenses.some(
      (item) =>
        item.datasetId === dataset.id ||
        (dataset.license.updatesIncluded && item.datasetId === dataset.previousDatasetId),
    );

  const openDataset = (dataset: Dataset) => {
    setSelected(dataset);
    let visitorId = window.localStorage.getItem("proofdata-visitor-id");
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      window.localStorage.setItem("proofdata-visitor-id", visitorId);
    }
    void fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasetId: dataset.id, visitorId }),
    })
      .then((response) => response.json())
      .then((payload) => {
        if (typeof payload.views === "number") {
          setPublishedDatasets((current) =>
            current.map((item) =>
              item.id === dataset.id ? { ...item, views: payload.views } : item,
            ),
          );
        }
      })
      .catch(() => undefined);
  };

  const createWalletProof = async (message: string) => {
    if (!account) throw new Error(locale === "tr" ? "Önce cüzdanını bağla." : "Connect your wallet first.");
    const nonce = `${Date.now()}:${crypto.randomUUID()}`;
    const signed = await signMessage({
      address: true,
      application: true,
      chainId: true,
      message,
      nonce,
    });
    return {
      address: signed.address ?? account.address.toString(),
      publicKey: account.publicKey.toString(),
      publicKeyBcs: account.publicKey.bcsToHex().toString(),
      publicKeyType: account.publicKey.constructor.name,
      publicKeyByteLength: account.publicKey.bcsToBytes().length,
      signatureType: signed.signature.constructor.name,
      signatureByteLength: signed.signature.bcsToBytes().length,
      fullMessage: signed.fullMessage,
      message: signed.message,
      nonce: signed.nonce,
      signature: signed.signature.toString(),
      signatureBcs: signed.signature.bcsToHex().toString(),
    };
  };

  const openManageListing = (dataset: Dataset) => {
    setManageListing(dataset);
    setManageName(dataset.name);
    setManageDescription(dataset.description);
    setManageCategory(dataset.category);
    setManagePrice(String(dataset.price));
    setManageStatus("");
  };

  const beginNewVersion = (dataset: Dataset) => {
    setPreviousDatasetId(dataset.id);
    setListingName(dataset.name);
    setListingDescription(dataset.description);
    setListingCategory(dataset.category);
    setListingPrice(String(dataset.price));
    setListingSource(dataset.source === "Not specified" ? "" : dataset.source);
    setListingGeography(dataset.geography);
    setListingLanguage(dataset.language);
    setListingCollectedFrom(dataset.collectedFrom);
    setListingCollectedTo(dataset.collectedTo);
    setListingUpdateFrequency(dataset.updateFrequency);
    setListingLabeled(dataset.labeled);
    setListingContainsPii(dataset.containsPersonalData);
    setListingUseCases(dataset.useCases.join(", "));
    setLicenseType(dataset.license.type);
    setLicenseCommercial(dataset.license.commercialUse);
    setLicenseTraining(dataset.license.modelTraining);
    setLicenseRedistribution(dataset.license.redistribution);
    setLicenseDuration(dataset.license.duration);
    setLicenseUpdates(dataset.license.updatesIncluded);
    setUploadFile(null);
    setManageListing(null);
    setUploadOpen(true);
  };

  const manageListingAction = async (
    action: "update" | "deactivate" | "reactivate",
  ) => {
    if (!manageListing || !account) {
      openWalletPicker();
      return;
    }
    setManageBusy(true);
    setManageStatus(
      locale === "tr" ? "Petra’da sahiplik imzasını onayla…" : "Approve the ownership signature in Petra…",
    );
    try {
      const changes =
        action === "update"
          ? {
              name: manageName.trim(),
              description: manageDescription.trim(),
              category: manageCategory,
              price: Number(managePrice),
            }
          : undefined;
      const message = `proofdata:listings:${action}:v1:${manageListing.id}:${changes ? JSON.stringify(changes) : ""}`;
      const proof = await createWalletProof(message);
      const response = await fetch("/api/listings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId: manageListing.id,
          action,
          changes,
          proof,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        listing?: {
          ownerAddress: string;
          manifestBlobName: string;
          manifest: ListingManifest;
          status?: "active" | "inactive";
          version?: number;
          revisions?: ListingRevision[];
          updatedAt?: number;
          reports?: number;
          views?: number;
        };
      };
      if (!response.ok || !result.listing) {
        throw new Error(result.error || "LISTING_UPDATE_FAILED");
      }
      const updated = manifestToDataset(
        result.listing.manifest,
        result.listing.ownerAddress,
        result.listing.manifestBlobName,
        result.listing,
      );
      if (!updated) throw new Error("INVALID_UPDATED_LISTING");
      setPublishedDatasets((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setManageListing(null);
      setManageStatus("");
    } catch (error) {
      setManageStatus(`${locale === "tr" ? "İşlem başarısız" : "Action failed"}: ${errorDetails(error)}`);
    } finally {
      setManageBusy(false);
    }
  };

  const reportListing = async (dataset: Dataset) => {
    if (!account) {
      setSelected(null);
      openWalletPicker();
      return;
    }
    const reason = "content-quality";
    setReportStatus(locale === "tr" ? "Petra’da rapor imzasını onayla…" : "Approve the report signature in Petra…");
    try {
      const message = `proofdata:reports:create:v1:${dataset.id}:${reason}`;
      const proof = await createWalletProof(message);
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId: dataset.id,
          reporterAddress: account.address.toString(),
          reason,
          proof,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "REPORT_FAILED");
      setReportStatus(locale === "tr" ? "Rapor alındı. Teşekkürler." : "Report received. Thank you.");
    } catch (error) {
      setReportStatus(`${locale === "tr" ? "Rapor gönderilemedi" : "Report failed"}: ${errorDetails(error)}`);
    }
  };

  const downloadDataset = async (dataset: Dataset) => {
    if (!dataset.encryption) {
      window.open(shelbyBlobUrl(dataset.ownerAddress, dataset.blobName), "_blank", "noopener,noreferrer");
      return;
    }
    if (!account) {
      openWalletPicker();
      return;
    }
    setDownloadStatus(locale === "tr" ? "Petra’da erişim imzasını onayla…" : "Approve access in Petra…");
    try {
      const message = `proofdata:access:unlock:v1:${dataset.id}:${dataset.encryption.keyId}`;
      const proof = await createWalletProof(message);
      const accessResponse = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unlock",
          datasetId: dataset.id,
          keyId: dataset.encryption.keyId,
          address: account.address.toString(),
          proof,
        }),
      });
      const access = (await accessResponse.json()) as { keyBase64?: string; error?: string };
      if (!accessResponse.ok || !access.keyBase64) {
        throw new Error(access.error || "ACCESS_DENIED");
      }
      setDownloadStatus(locale === "tr" ? "Şifreli dosya indiriliyor…" : "Downloading encrypted file…");
      const encryptedResponse = await fetch(
        shelbyBlobUrl(dataset.ownerAddress, dataset.blobName),
        { cache: "no-store" },
      );
      if (!encryptedResponse.ok) throw new Error("SHELBY_DOWNLOAD_FAILED");
      const encrypted = await encryptedResponse.arrayBuffer();
      const key = await crypto.subtle.importKey(
        "raw",
        base64ToBytes(access.keyBase64),
        "AES-GCM",
        false,
        ["decrypt"],
      );
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(dataset.encryption.iv) },
        key,
        encrypted,
      );
      const url = URL.createObjectURL(new Blob([decrypted], { type: dataset.mimeType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = dataset.originalFileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setDownloadStatus(locale === "tr" ? "Dosya çözüldü ve indirildi." : "File decrypted and downloaded.");
    } catch (error) {
      setDownloadStatus(`${locale === "tr" ? "İndirme başarısız" : "Download failed"}: ${errorDetails(error)}`);
    }
  };

  const toggleFavorite = async (id: string) => {
    if (!account) {
      openWalletPicker();
      return;
    }
    try {
      const message = `proofdata:preferences:favorite:v1:${id}`;
      const proof = await createWalletProof(message);
      const response = await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: account.address.toString(),
          action: "favorite",
          datasetId: id,
          proof,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "FAVORITE_FAILED");
      setFavorites(payload.preferences.favorites ?? []);
    } catch (error) {
      setWalletStatus(errorDetails(error));
    }
  };

  const markNotificationsRead = async () => {
    if (!account) return;
    try {
      const message = "proofdata:preferences:read-notifications:v1:";
      const proof = await createWalletProof(message);
      const response = await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: account.address.toString(),
          action: "read-notifications",
          datasetId: "",
          proof,
        }),
      });
      const payload = await response.json();
      if (response.ok) {
        setReadNotificationsAt(payload.preferences.readNotificationsAt ?? Date.now());
      }
    } catch {
      // The notification panel remains usable if the read marker is not saved.
    }
  };

  const submitDispute = async () => {
    if (!account || !disputeDataset || !disputeDetails.trim()) return;
    setDisputeStatus(locale === "tr" ? "Petra’da talebi imzala…" : "Sign the request in Petra…");
    try {
      const message = `proofdata:disputes:create:v1:${disputeDataset.id}:${disputeReason}`;
      const proof = await createWalletProof(message);
      const response = await fetch("/api/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          datasetId: disputeDataset.id,
          address: account.address.toString(),
          reason: disputeReason,
          details: disputeDetails,
          proof,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "DISPUTE_FAILED");
      setDisputes((current) => [payload.dispute, ...current]);
      setDisputeDataset(null);
      setDisputeDetails("");
      setDisputeStatus("");
    } catch (error) {
      setDisputeStatus(`${locale === "tr" ? "Talep gönderilemedi" : "Request failed"}: ${errorDetails(error)}`);
    }
  };

  const downloadLicenseCertificate = (dataset: Dataset, sale: SaleActivity) => {
    const certificate = {
      standard: "ProofData Dataset License v1",
      network: "ShelbyNet",
      datasetId: dataset.id,
      datasetName: dataset.name,
      integrityRoot: dataset.fullRoot,
      buyerAddress: sale.buyerAddress,
      sellerAddress: sale.sellerAddress,
      transactionHash: sale.transactionHash,
      purchasedAt: new Date(sale.createdAt).toISOString(),
      price: `${sale.price} ShelbyUSD`,
      terms: sale.license ?? dataset.license,
      verificationUrl: `https://explorer.aptoslabs.com/txn/${sale.transactionHash}?network=shelbynet`,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(certificate, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${dataset.name.replace(/[^a-zA-Z0-9_-]/g, "-")}-license.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const respondToDispute = async (dispute: Dispute) => {
    if (!account || !sellerResponse.trim()) return;
    setDisputeStatus(locale === "tr" ? "Petra’da yanıtı imzala…" : "Sign the response in Petra…");
    try {
      const responseText = sellerResponse.trim();
      const message = `proofdata:disputes:respond:v1:${dispute.id}:${responseText}`;
      const proof = await createWalletProof(message);
      const response = await fetch("/api/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "respond",
          id: dispute.id,
          address: account.address.toString(),
          response: responseText,
          proof,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "RESPONSE_FAILED");
      setDisputes((current) =>
        current.map((item) => (item.id === dispute.id ? payload.dispute : item)),
      );
      setRespondingDisputeId("");
      setSellerResponse("");
      setDisputeStatus("");
    } catch (error) {
      setDisputeStatus(`${locale === "tr" ? "Yanıt gönderilemedi" : "Response failed"}: ${errorDetails(error)}`);
    }
  };

  const submitReview = async (dataset: Dataset) => {
    if (!account || !reviewComment.trim()) return;
    setReviewStatus(locale === "tr" ? "Petra’da değerlendirmeyi imzala…" : "Sign the review in Petra…");
    try {
      const message = `proofdata:reviews:create:v1:${dataset.id}:${reviewScore}`;
      const proof = await createWalletProof(message);
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId: dataset.id,
          reviewerAddress: account.address.toString(),
          score: reviewScore,
          comment: reviewComment,
          proof,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "REVIEW_FAILED");
      setReviews((current) => [
        payload.review,
        ...current.filter(
          (item) =>
            !(
              item.datasetId === dataset.id &&
              sameAddress(item.reviewerAddress, account.address.toString())
            ),
        ),
      ]);
      setReviewComment("");
      setReviewStatus(locale === "tr" ? "Değerlendirmen yayımlandı." : "Your review is live.");
    } catch (error) {
      setReviewStatus(`${locale === "tr" ? "Değerlendirme gönderilemedi" : "Review failed"}: ${errorDetails(error)}`);
    }
  };

  const openWalletPicker = () => {
    setWalletStatus("");
    setWalletPickerOpen(true);
  };

  const connectWallet = (walletName: string) => {
    setWalletStatus(c.connectingWallet);
    setWalletPickerOpen(false);
    connect(walletName);
  };

  const closeUpload = () => {
    if (uploadBusy) return;
    setUploadOpen(false);
    setUploadFile(null);
    setListingName("");
    setListingDescription("");
    setListingCategory("Onchain");
    setListingPrice("");
    setListingSource("");
    setListingGeography("Global");
    setListingLanguage("English");
    setListingCollectedFrom("");
    setListingCollectedTo("");
    setListingUpdateFrequency("One-time");
    setListingLabeled(false);
    setListingContainsPii(false);
    setListingUseCases("");
    setLicenseType("Commercial");
    setLicenseCommercial(true);
    setLicenseTraining(true);
    setLicenseRedistribution(false);
    setLicenseDuration("Perpetual");
    setLicenseUpdates(true);
    setUploadStatus("");
    setUploadTransactionHash("");
    setPreviousDatasetId("");
  };

  const selectUploadFile = (file: File | null) => {
    setUploadFile(file);
    setUploadStatus("");
    setUploadTransactionHash("");
    if (!file) return;
    if (!previousDatasetId) {
      setListingName(file.name.replace(/\.[^/.]+$/, ""));
      setListingDescription("");
      setListingCategory("Onchain");
      setListingPrice("");
      setListingSource("");
      setListingGeography("Global");
      setListingLanguage("English");
      setListingCollectedFrom("");
      setListingCollectedTo("");
      setListingUpdateFrequency("One-time");
      setListingLabeled(false);
      setListingContainsPii(false);
      setListingUseCases("");
      setLicenseType("Commercial");
      setLicenseCommercial(true);
      setLicenseTraining(true);
      setLicenseRedistribution(false);
      setLicenseDuration("Perpetual");
      setLicenseUpdates(true);
    }
  };

  const publishDataset = async () => {
    if (!uploadFile || uploadBusy) return;

    const salePrice = Number.parseFloat(listingPrice.replace(",", "."));
    if (!listingName.trim()) {
      setUploadStatus(locale === "tr" ? "Veri setine bir isim yaz." : "Enter a dataset name.");
      return;
    }
    if (!listingDescription.trim() || !listingSource.trim() || !listingUseCases.trim()) {
      setUploadStatus(
        locale === "tr"
          ? "Kaliteli bir ilan için açıklama, veri kaynağı ve kullanım alanlarını doldur."
          : "Add a description, data source, and use cases for a trustworthy listing.",
      );
      return;
    }
    if (!Number.isFinite(salePrice) || salePrice < 0) {
      setUploadStatus(
        locale === "tr"
          ? "Geçerli bir satış fiyatı yaz. Ücretsiz olacaksa 0 yaz."
          : "Enter a valid sale price. Use 0 for a free dataset.",
      );
      return;
    }

    if (!connected || !account) {
      setUploadStatus(locale === "tr" ? "Önce Petra cüzdanını bağla." : "Connect Petra first.");
      setUploadOpen(false);
      openWalletPicker();
      return;
    }

    if (uploadFile.size > 100 * 1024 * 1024) {
      setUploadStatus(
        locale === "tr"
          ? "Tarayıcıdan yayınlama için dosya en fazla 100 MB olabilir."
          : "Browser publishing currently supports files up to 100 MB.",
      );
      return;
    }

    setUploadBusy(true);
    setUploadTransactionHash("");
    let phase = locale === "tr" ? "ağ kontrolü" : "network check";

    try {
      const walletNetworkName = network?.name?.toLowerCase() ?? "";
      if (["mainnet", "testnet", "devnet", "local"].includes(walletNetworkName)) {
        throw new Error(`WRONG_WALLET_NETWORK: ${walletNetworkName}`);
      }

      phase = locale === "tr" ? "bakiye kontrolü" : "balance check";
      setUploadStatus(locale === "tr" ? "APT ve ShelbyUSD bakiyesi kontrol ediliyor…" : "Checking APT and ShelbyUSD balances…");
      const [aptBalance, shelbyUsdBalance] = await Promise.all([
        aptosClient
          .getBalance({
            accountAddress: account.address,
            asset: "0x1::aptos_coin::AptosCoin",
          })
          .catch(() => null),
        aptosClient
          .getBalance({
            accountAddress: account.address,
            asset: SHELBY_USD_METADATA,
          })
          .catch(() => null),
      ]);
      if (aptBalance === 0) throw new Error("INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE");
      if (shelbyUsdBalance !== null && shelbyUsdBalance < 100_000_000) {
        throw new Error("EBLOB_WRITE_INSUFFICIENT_FUNDS: at least 1 ShelbyUSD is required");
      }

      phase = locale === "tr" ? "dosya kanıtı hazırlama" : "file proof";
      setUploadStatus(locale === "tr" ? "Dosya şifreleniyor ve doğrulama kanıtı hazırlanıyor…" : "Encrypting the file and preparing its proof…");
      const sdk = await import("@shelby-protocol/sdk/browser");
      const originalData = new Uint8Array(await uploadFile.arrayBuffer());
      const dataKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
      );
      const encryptionIv = crypto.getRandomValues(new Uint8Array(12));
      const encryptedBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: encryptionIv },
        dataKey,
        originalData,
      );
      const blobData = new Uint8Array(encryptedBuffer);
      const rawDataKey = new Uint8Array(await crypto.subtle.exportKey("raw", dataKey));
      const keyId = crypto.randomUUID().replaceAll("-", "");
      const provider = await sdk.createDefaultErasureCodingProvider();
      const config = sdk.defaultErasureCodingConfig();
      const commitments = await sdk.generateCommitments(provider, blobData);
      const preview = await buildPreview(uploadFile);
      const createdAt = uploadFile.lastModified;
      const safeFileName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const blobName = sdk.BlobNameSchema.parse(
        `proofdata/${uploadFile.lastModified}-${keyId.slice(0, 12)}-${safeFileName}.encrypted`,
      );
      const extension = uploadFile.name.split(".").pop()?.toUpperCase() || "FILE";
      const manifest: ListingManifest = {
        version: 1,
        name: listingName.trim(),
        description:
          listingDescription.trim() ||
          (locale === "tr"
            ? "ShelbyNet üzerinde doğrulanmış ve yayınlanmış veri seti."
            : "Verified dataset published on ShelbyNet."),
        category: listingCategory,
        price: salePrice,
        format: extension,
        sizeBytes: uploadFile.size,
        mimeType: uploadFile.type || "application/octet-stream",
        blobName,
        dataRoot: commitments.blob_merkle_root,
        createdAt,
        preview,
        originalFileName: uploadFile.name,
        source: listingSource.trim(),
        geography: listingGeography.trim(),
        language: listingLanguage.trim(),
        collectedFrom: listingCollectedFrom,
        collectedTo: listingCollectedTo,
        updateFrequency: listingUpdateFrequency,
        labeled: listingLabeled,
        containsPersonalData: listingContainsPii,
        useCases: listingUseCases
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 8),
        license: {
          type: licenseType,
          commercialUse: licenseCommercial,
          modelTraining: licenseTraining,
          redistribution: licenseRedistribution,
          duration: licenseDuration,
          updatesIncluded: licenseUpdates,
        },
        encryption: {
          algorithm: "AES-GCM",
          iv: bytesToBase64(encryptionIv),
          keyId,
          originalSize: uploadFile.size,
        },
        previousDatasetId: previousDatasetId || undefined,
      };
      const manifestData = new TextEncoder().encode(JSON.stringify(manifest));
      const manifestHash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", manifestData)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      const manifestBlobName = sdk.BlobNameSchema.parse(
        `${MANIFEST_PREFIX}${uploadFile.lastModified}-${safeFileName}-${manifestHash.slice(0, 16)}.json`,
      );
      const manifestCommitments = await sdk.generateCommitments(provider, manifestData);
      const shelbyClient = new sdk.ShelbyClient({
        network: Network.SHELBYNET,
        apiKey: SHELBY_API_KEY || undefined,
      });
      const [existingBlob, existingManifest] = await Promise.all([
        shelbyClient.coordination
          .getBlobMetadata({ account: account.address, name: blobName })
          .catch(() => undefined),
        shelbyClient.coordination
          .getBlobMetadata({ account: account.address, name: manifestBlobName })
          .catch(() => undefined),
      ]);

      if (!existingBlob || !existingManifest) {
        phase = locale === "tr" ? "Petra onayı" : "Petra approval";
        const missingBlobs = [
          ...(!existingBlob
            ? [{
                blobName,
                blobSize: blobData.length,
                blobMerkleRoot: commitments.blob_merkle_root,
                numChunksets: sdk.expectedTotalChunksets(
                  blobData.length,
                  config.chunkSizeBytes * config.erasure_k,
                ),
              }]
            : []),
          ...(!existingManifest
            ? [{
                blobName: manifestBlobName,
                blobSize: manifestData.length,
                blobMerkleRoot: manifestCommitments.blob_merkle_root,
                numChunksets: sdk.expectedTotalChunksets(
                  manifestData.length,
                  config.chunkSizeBytes * config.erasure_k,
                ),
              }]
            : []),
        ];
        const expirationMicros = (Date.now() + 30 * 24 * 60 * 60 * 1000) * 1000;
        const payload = missingBlobs.length === 1
          ? sdk.ShelbyBlobClient.createRegisterBlobPayload({
              account: account.address,
              blobName: missingBlobs[0].blobName,
              blobSize: missingBlobs[0].blobSize,
              blobMerkleRoot: missingBlobs[0].blobMerkleRoot,
              expirationMicros,
              numChunksets: missingBlobs[0].numChunksets,
              encoding: config.enumIndex,
            })
          : sdk.ShelbyBlobClient.createBatchRegisterBlobsPayload({
          account: account.address,
          expirationMicros,
          blobs: missingBlobs,
          encoding: config.enumIndex,
        });

        setUploadStatus(
          locale === "tr"
            ? "Petra açılacak. İşlemi cüzdandan onayla."
            : "Petra will open. Approve the transaction in your wallet.",
        );
        const submitted = await signAndSubmitTransaction({
          sender: account.address,
          data: payload,
        });
        setUploadTransactionHash(submitted.hash);
        phase = locale === "tr" ? "zincir onayı" : "on-chain confirmation";
        setUploadStatus(locale === "tr" ? "İşlem ShelbyNet’te onaylanıyor…" : "Confirming on ShelbyNet…");
        await aptosClient.waitForTransaction({
          transactionHash: submitted.hash,
          options: { checkSuccess: true },
        });
      }

      if (!existingBlob?.isWritten) {
        phase = locale === "tr" ? "Shelby depolama yüklemesi" : "Shelby storage upload";
        setUploadStatus(locale === "tr" ? "Dosya Shelby depolamasına gönderiliyor…" : "Uploading to Shelby storage…");
        await shelbyClient.rpc.putBlob({
          account: account.address,
          blobName,
          blobData,
        });
      }

      if (!existingManifest?.isWritten) {
        phase = locale === "tr" ? "ilan kaydı yüklemesi" : "listing manifest upload";
        setUploadStatus(locale === "tr" ? "İlan ortak Shelby pazarına kaydediliyor…" : "Saving the listing to the shared Shelby market…");
        await shelbyClient.rpc.putBlob({
          account: account.address,
          blobName: manifestBlobName,
          blobData: manifestData,
        });
      }

      phase = locale === "tr" ? "pazar listesine ekleme" : "marketplace indexing";
      setUploadStatus(
        locale === "tr"
          ? "İlan tüm tarayıcılarda görünecek ortak listeye ekleniyor…"
          : "Adding the listing to the shared cross-browser market…",
      );
      const listingResponse = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerAddress: account.address.toString(),
          manifestBlobName,
        }),
      });
      const listingResult = (await listingResponse.json().catch(() => null)) as
        | {
            error?: string;
            duplicate?: boolean;
            listing?: {
              ownerAddress: string;
              manifestBlobName: string;
              manifest: ListingManifest;
              status?: "active" | "inactive";
              version?: number;
              revisions?: ListingRevision[];
              updatedAt?: number;
              reports?: number;
              views?: number;
            };
          }
        | null;
      if (!listingResponse.ok || !listingResult?.listing) {
        throw new Error(
          listingResult?.error || `MARKETPLACE_INDEX_HTTP_${listingResponse.status}`,
        );
      }

      const published = manifestToDataset(
        listingResult.listing.manifest,
        listingResult.listing.ownerAddress,
        listingResult.listing.manifestBlobName,
        listingResult.listing,
      );
      if (!published) throw new Error("The generated listing manifest is invalid.");
      phase = locale === "tr" ? "güvenli erişim anahtarı" : "secure access key";
      setUploadStatus(
        locale === "tr"
          ? "Son adım: Petra’da güvenli teslimat kaydını imzala…"
          : "Final step: sign the secure-delivery record in Petra…",
      );
      const accessMessage = `proofdata:access:register:v1:${published.id}:${keyId}`;
      const accessProof = await createWalletProof(accessMessage);
      const accessResponse = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          datasetId: published.id,
          keyId,
          keyBase64: bytesToBase64(rawDataKey),
          address: account.address.toString(),
          proof: accessProof,
        }),
      });
      const accessResult = (await accessResponse.json().catch(() => null)) as
        | { registered?: boolean; error?: string }
        | null;
      if (!accessResponse.ok || !accessResult?.registered) {
        throw new Error(accessResult?.error || "SECURE_ACCESS_REGISTRATION_FAILED");
      }
      setPublishedDatasets((current) => [
        published,
        ...current.filter((item) => item.id !== published.id),
      ]);
      setUploadStatus(
        listingResult.duplicate
          ? (locale === "tr" ? "Bu dosya zaten pazarda; tekrar ilan oluşturulmadı." : "This file is already listed; no duplicate was created.")
          : (locale === "tr" ? "Yayınlandı! Veri setin artık pazarda." : "Published! Your dataset is now in the market."),
      );
      setView("studio");
      setUploadOpen(false);
      setUploadFile(null);
      setListingName("");
      setListingDescription("");
      setListingCategory("Onchain");
      setListingPrice("");
      setListingSource("");
      setListingGeography("Global");
      setListingLanguage("English");
      setListingCollectedFrom("");
      setListingCollectedTo("");
      setListingUpdateFrequency("One-time");
      setListingLabeled(false);
      setListingContainsPii(false);
      setListingUseCases("");
      setLicenseType("Commercial");
      setLicenseCommercial(true);
      setLicenseTraining(true);
      setLicenseRedistribution(false);
      setLicenseDuration("Perpetual");
      setLicenseUpdates(true);
      setUploadTransactionHash("");
      setPreviousDatasetId("");
    } catch (error) {
      console.error("Shelby publishing failed", { phase, error });
      setUploadStatus(publishingError(error, phase, locale));
    } finally {
      setUploadBusy(false);
    }
  };

  const submitLicensePayment = async () => {
    if (!purchase || transactionBusy) return;
    if (!connected || !account) {
      openWalletPicker();
      return;
    }
    setTransactionBusy(true);
    setTransactionHash("");
    setWalletStatus(c.confirmInWallet);

    try {
      if (network?.name?.toLowerCase() !== "shelbynet") {
        await changeNetwork(Network.SHELBYNET);
      }

      const rawAmount = Math.round(purchase.price * 100_000_000).toString();
      const submitted = await signAndSubmitTransaction({
        sender: account.address,
        data: {
          function: "0x1::primary_fungible_store::transfer",
          typeArguments: ["0x1::fungible_asset::Metadata"],
          functionArguments: [
            SHELBY_USD_METADATA,
            purchase.ownerAddress,
            rawAmount,
          ],
        },
      });

      setTransactionHash(submitted.hash);
      setWalletStatus(c.transactionPending);
      await aptosClient.waitForTransaction({
        transactionHash: submitted.hash,
        options: { checkSuccess: true },
      });
      setWalletStatus(c.transactionSuccess);
      try {
        const activityResponse = await fetch("/api/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            buyerAddress: account.address.toString(),
            ownerAddress: purchase.ownerAddress,
            manifestBlobName: purchase.id.slice(purchase.ownerAddress.length + 1),
            transactionHash: submitted.hash,
          }),
        });
        if (activityResponse.ok) {
          const activityPayload = (await activityResponse.json()) as {
            activity?: SaleActivity;
          };
          if (activityPayload.activity) {
            setSaleActivities((current) => [
              activityPayload.activity!,
              ...current.filter(
                (item) => item.transactionHash !== activityPayload.activity!.transactionHash,
              ),
            ]);
            setPurchase(null);
            setView("studio");
            setStudioTab("purchases");
          }
        } else {
          console.warn("The confirmed license could not be added to the activity feed.");
        }
      } catch (activityError) {
        console.warn("Activity indexing failed after the confirmed payment.", activityError);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWalletStatus(`${c.transactionFailed}: ${message}`);
    } finally {
      setTransactionBusy(false);
    }
  };

  return (
    <main className="site-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("explore")} aria-label="ProofData home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>Proof<span>Data</span></span>
        </button>
        <nav aria-label="Primary navigation">
          {(["explore", "studio", "activity"] as View[]).map((item) => (
            <button
              key={item}
              className={view === item ? "active" : ""}
              onClick={() => setView(item)}
            >
              {item === "explore" ? c.explore : item === "studio" ? c.studio : c.activity}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <span className="network"><i /> ShelbyNet</span>
          <a
            className="faucet-link"
            href="https://docs.shelby.xyz/apis/faucet/shelbyusd"
            target="_blank"
            rel="noreferrer"
          >
            Faucet
          </a>
          <label className="language-control" aria-label="Language">
            <span>◎</span>
            <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              {localeOptions.map((option) => (
                <option value={option.code} key={option.code}>{option.label}</option>
              ))}
            </select>
          </label>
          {connected && <div className="notification-wrap">
            <button className="notification-button" onClick={() => setNotificationsOpen((value) => !value)} aria-label={locale === "tr" ? "Bildirimler" : "Notifications"}>
              ◇{unreadNotifications > 0 && <b>{unreadNotifications}</b>}
            </button>
            {notificationsOpen && <div className="notification-panel">
              <div><strong>{locale === "tr" ? "Bildirimler" : "Notifications"}</strong><button onClick={() => void markNotificationsRead()}>{locale === "tr" ? "Okundu işaretle" : "Mark read"}</button></div>
              {notifications.length ? notifications.slice(0, 8).map((item) => <button key={item.id} onClick={() => { setView("studio"); setNotificationsOpen(false); }}><b>{item.title}</b><span>{item.body}</span><small>{new Date(item.createdAt).toLocaleString(locale)}</small></button>) : <p>{locale === "tr" ? "Henüz bildirim yok." : "No notifications yet."}</p>}
            </div>}
          </div>}
          <button
            className="wallet"
            onClick={() => connected ? disconnect() : openWalletPicker()}
            title={connected ? c.disconnectWallet : c.connectWallet}
          >
            {connected ? <><span className="wallet-dot" />{shortAddress(account?.address.toString())}</> : c.connectWallet}
          </button>
        </div>
      </header>

      {view === "explore" && (
        <>
          <section className="hero">
            <div className="hero-grid" aria-hidden="true" />
            <div className="hero-orb" aria-hidden="true">
              <div className="orbit orbit-one"><i /><i /><i /></div>
              <div className="orbit orbit-two"><i /><i /></div>
              <div className="core"><span>∑</span><small>VERIFIED</small></div>
            </div>
            <div className="eyebrow"><span>{c.new}</span> {c.launch}</div>
            <h1>{c.heroOne}<br /><em>{c.heroTwo}</em></h1>
            <p className="hero-copy">{c.heroCopy}</p>
            <div className="search-shell">
              <span className="search-icon">⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={c.searchPlaceholder}
                aria-label="Search datasets"
              />
              <button onClick={() => document.getElementById("market")?.scrollIntoView({ behavior: "smooth" })}>{c.search}</button>
            </div>
            <div className="hero-trust">
              <span><i className="check">✓</i> {c.trustMerkle}</span>
              <span><i className="check">✓</i> {c.trustWallet}</span>
              <span><i className="check">✓</i> {c.trustAgent}</span>
            </div>
          </section>

          <section className="metrics-strip">
            <Metric value={verifiedBytes ? formatFileSize(verifiedBytes) : "0 B"} label={c.verifiedData} hint={activeDatasets.length ? "LIVE" : "—"} />
            <Metric value={agentReadyRecords.toLocaleString(locale)} label={c.agentRecords} hint={activeDatasets.length ? `${activeDatasets.length} DATASET` : "—"} />
            <Metric value={`${integrityRate}%`} label={c.integrityRate} hint={activeDatasets.length ? `${verifiedCount}/${activeDatasets.length}` : "—"} />
            <Metric value="—" label={c.retrievalTime} hint="—" />
          </section>

          <section className="market" id="market">
            <div className="section-head">
              <div>
                <p className="section-kicker">{c.curated}</p>
                <h2>{c.marketTitle}</h2>
              </div>
              <button className="publish-button" onClick={() => setUploadOpen(true)}>
                <span>＋</span> {c.publish}
              </button>
            </div>

            <div className="filters" aria-label="Dataset categories">
              {["All datasets", "Language", "Vision", "Onchain", "Mobility", "Climate", "Finance"].map((item) => (
                <button
                  className={category === item ? "active" : ""}
                  key={item}
                  onClick={() => setCategory(item)}
                >
                  {categoryLabel(item)}
                </button>
              ))}
              <select
                className="market-sort"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
                aria-label={locale === "tr" ? "İlanları sırala" : "Sort listings"}
              >
                <option value="newest">{locale === "tr" ? "En yeni" : "Newest"}</option>
                <option value="price-low">{locale === "tr" ? "Fiyat: düşükten yükseğe" : "Price: low to high"}</option>
                <option value="price-high">{locale === "tr" ? "Fiyat: yüksekten düşüğe" : "Price: high to low"}</option>
                <option value="size">{locale === "tr" ? "Dosya boyutu" : "File size"}</option>
                <option value="trust">{locale === "tr" ? "En güvenilir" : "Highest trust"}</option>
                <option value="popular">{locale === "tr" ? "En çok görüntülenen" : "Most viewed"}</option>
              </select>
            </div>

            {marketLoading ? (
              <div className="empty-state">
                <span className="loading-dot">◌</span>
                <h3>{locale === "tr" ? "Pazar yükleniyor" : "Loading the marketplace"}</h3>
                <p>{locale === "tr" ? "Doğrulanmış ortak ilanlar alınıyor…" : "Loading shared verified listings…"}</p>
              </div>
            ) : marketError ? (
              <div className="empty-state">
                <span>!</span>
                <h3>{locale === "tr" ? "Pazar şu anda yüklenemedi" : "The market could not load"}</h3>
                <p>{marketError}</p>
                <button onClick={() => window.location.reload()}>{locale === "tr" ? "Tekrar dene" : "Retry"}</button>
              </div>
            ) : filtered.length ? (
              <div className="dataset-grid">
                {filtered.map((dataset) => (
                  <article className="dataset-card" key={dataset.id}>
                    <button
                      className={`heart ${favorites.includes(dataset.id) ? "saved" : ""}`}
                      onClick={() => toggleFavorite(dataset.id)}
                      aria-label={favorites.includes(dataset.id) ? "Remove from favorites" : "Add to favorites"}
                    >
                      {favorites.includes(dataset.id) ? "♥" : "♡"}
                    </button>
                    <button className="card-main" onClick={() => openDataset(dataset)}>
                      <div className="card-visual">
                        <DataGlyph accent={dataset.accent} />
                        <span className="format">{dataset.format}</span>
                        <span className="freshness">{dataset.freshness}</span>
                      </div>
                      <div className="card-body">
                        <div className="verified-line"><span>✓</span> {c.verifiedOn} · {dataset.root}</div>
                        <h3>{dataset.name}</h3>
                        <p>{dataset.description}</p>
                        <div className="tag-row">
                          {dataset.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                        </div>
                        <div className="owner-row">
                          <span className="avatar">{dataset.ownerMark}</span>
                          <span><small>{c.publishedBy}</small>{dataset.owner}</span>
                          <b className="shelby-badge">{trustScore(dataset, saleActivities.filter((sale) => sale.datasetId === dataset.id).length, dataset.reports, reviewAverage(dataset.id))}<small>TRUST</small></b>
                        </div>
                        <div className="card-stats">
                          <span><small>{c.records}</small>{dataset.rows}</span>
                          <span><small>{c.size}</small>{dataset.size}</span>
                          <span><small>{locale === "tr" ? "Görüntülenme" : "Views"}</small>{dataset.views}</span>
                          <strong>{dataset.price === 0 ? c.open : `${dataset.price} SUSD`}</strong>
                        </div>
                      </div>
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span>＋</span>
                <h3>{c.emptyMarketTitle}</h3>
                <p>{c.emptyMarketCopy}</p>
                <button onClick={() => setUploadOpen(true)}>{c.publish}</button>
              </div>
            )}
          </section>

          <section className="proof-section">
            <div className="proof-copy">
              <p className="section-kicker">{c.proofKicker}</p>
              <h2>{c.proofTitle}</h2>
              <p>{c.proofCopy}</p>
              <div className="proof-steps">
                <div><span>01</span><p><strong>{c.localFingerprint}</strong>{c.localFingerprintCopy}</p></div>
                <div><span>02</span><p><strong>{c.shelbyCommitment}</strong>{c.shelbyCommitmentCopy}</p></div>
                <div><span>03</span><p><strong>{c.continuousVerification}</strong>{c.continuousVerificationCopy}</p></div>
              </div>
            </div>
            <div className="proof-console">
              <div className="console-top"><span><i /><i /><i /></span><b>INTEGRITY CONSOLE</b><em>LIVE</em></div>
              <div className="console-body">
                <p><span>READY</span> {latestDataset ? latestDataset.name : c.waitingForDataset}</p>
                <div className="hash-line">{latestDataset?.root ?? "—"}</div>
                <div className="verification-result">
                  <span>{latestDataset ? "✓" : "○"}</span>
                  <div>
                    <strong>{latestDataset ? (locale === "tr" ? "Bütünlük doğrulandı" : "Integrity verified") : c.waitingForDataset}</strong>
                    <small>{latestDataset?.size ?? "—"}</small>
                  </div>
                  <em>{latestDataset ? "100%" : "—"}</em>
                </div>
              </div>
            </div>
          </section>

          <section className="agent-section">
            <div>
              <span className="agent-chip">AGENT API</span>
              <h2>{c.agentTitleOne}<br />{c.agentTitleTwo}</h2>
              <p>{c.agentCopy}</p>
              <button onClick={() => setView("activity")}>{c.watchNetwork} <span>→</span></button>
            </div>
            <div className="code-window">
              <div className="code-tabs"><span className="active">ProofData Agent API v1</span></div>
              <pre><code><i>GET</i> /api/agent?q=vision{"\n"}<i>POST</i> /api/agent {"{"} action: &quot;quote&quot;, datasetId {"}"}</code></pre>
              <div className="code-response"><span>✓</span> discover · quote · license-check · integrity-root</div>
            </div>
          </section>
        </>
      )}

      {view === "studio" && (
        <section className="app-view">
          <div className="view-head">
            <div><p className="section-kicker">{c.studioKicker}</p><h1>{c.studioTitle}</h1><p>{c.studioCopy}</p></div>
            <button className="publish-button" onClick={() => setUploadOpen(true)}><span>＋</span> {c.newDataset}</button>
          </div>
          <div className="studio-metrics">
            <Metric value={`${lifetimeEarnings.toFixed(2)} SUSD`} label={c.lifetimeEarnings} hint={sellerSales.length ? "LIVE" : "—"} />
            <Metric value={String(sellerSales.length)} label={locale === "tr" ? "Toplam satış" : "Total sales"} hint="SHELBY" />
            <Metric value={String(ownedDatasets.length)} label={c.publishedDatasets} hint={ownedDatasets.some((item) => item.status === "active") ? "LIVE" : "—"} />
            <Metric value={String(purchasedLicenses.length)} label={locale === "tr" ? "Satın aldıklarım" : "Purchases"} hint="LICENSED" />
          </div>
          <div className="studio-tabs">
            <button className={studioTab === "listings" ? "active" : ""} onClick={() => setStudioTab("listings")}>{locale === "tr" ? "İlanlarım" : "My listings"}</button>
            <button className={studioTab === "purchases" ? "active" : ""} onClick={() => setStudioTab("purchases")}>{locale === "tr" ? "Satın aldıklarım" : "Purchases"}</button>
            <button className={studioTab === "disputes" ? "active" : ""} onClick={() => setStudioTab("disputes")}>{locale === "tr" ? "Sorunlar" : "Disputes"} {disputes.filter((item) => item.status === "open").length ? `(${disputes.filter((item) => item.status === "open").length})` : ""}</button>
          </div>
          <div className="studio-layout">
            <div className="portfolio">
              <div className="panel-head"><h2>{studioTab === "listings" ? (locale === "tr" ? "İlanlarım" : "My listings") : studioTab === "purchases" ? (locale === "tr" ? "Lisanslarım" : "My licenses") : (locale === "tr" ? "Sorun ve iade talepleri" : "Issues and refund requests")}</h2></div>
              {!connected ? (
                <div className="empty-state compact">
                  <span>◇</span>
                  <h3>{locale === "tr" ? "Cüzdanını bağla" : "Connect your wallet"}</h3>
                  <p>{locale === "tr" ? "İlanlarını, satışlarını ve satın aldıklarını görmek için Petra’yı bağla." : "Connect Petra to see your listings, sales, and purchases."}</p>
                  <button onClick={openWalletPicker}>{c.connectWallet}</button>
                </div>
              ) : studioTab === "listings" && ownedDatasets.length ? (
                <div className="studio-dataset-list">
                  {ownedDatasets.map((dataset) => (
                    <div className="studio-listing-row" key={dataset.id}>
                      <button onClick={() => openDataset(dataset)}>
                        <span className="avatar">{dataset.ownerMark}</span>
                        <span><strong>{dataset.name}</strong><small>v{dataset.version} · {dataset.format} · {dataset.size} · {dataset.views} {locale === "tr" ? "görüntülenme" : "views"} · {saleActivities.filter((sale) => sale.datasetId === dataset.id).length} {locale === "tr" ? "satış" : "sales"}</small></span>
                        <b className={dataset.status === "active" ? "status-active" : "status-inactive"}>
                          {dataset.status === "active" ? (locale === "tr" ? "SATIŞTA" : "ACTIVE") : (locale === "tr" ? "KAPALI" : "DELISTED")}
                        </b>
                      </button>
                      <button className="manage-button" onClick={() => openManageListing(dataset)}>{locale === "tr" ? "Yönet" : "Manage"}</button>
                    </div>
                  ))}
                </div>
              ) : studioTab === "purchases" && purchasedLicenses.length ? (
                <div className="studio-dataset-list">
                  {purchasedLicenses.map((license) => {
                    const dataset =
                      publishedDatasets.find(
                        (item) =>
                          item.previousDatasetId === license.datasetId &&
                          item.license.updatesIncluded,
                      ) ?? publishedDatasets.find((item) => item.id === license.datasetId);
                    return (
                      <div className="studio-listing-row" key={license.transactionHash}>
                        <button onClick={() => dataset && openDataset(dataset)}>
                          <span className="avatar">✓</span>
                          <span><strong>{license.datasetName}</strong><small>{new Date(license.createdAt).toLocaleString(locale)} · {license.price} SUSD</small></span>
                          <b>LICENSED</b>
                        </button>
                        {dataset && <div className="row-actions">
                          <button className="manage-button" onClick={() => downloadDataset(dataset)}>{locale === "tr" ? "İndir" : "Download"}</button>
                          <button className="manage-button" onClick={() => downloadLicenseCertificate(dataset, license)}>{locale === "tr" ? "Lisans" : "License"}</button>
                          <button className="issue-button" onClick={() => { setDisputeDataset(dataset); setDisputeStatus(""); }}>{locale === "tr" ? "Sorun bildir" : "Report issue"}</button>
                        </div>}
                      </div>
                    );
                  })}
                </div>
              ) : studioTab === "disputes" && disputes.length ? (
                <div className="dispute-list">
                  {disputes.map((item) => {
                    const dataset = publishedDatasets.find((entry) => entry.id === item.datasetId);
                    return <article key={item.id}>
                      <div><b>{dataset?.name ?? "Dataset"}</b><span className={`dispute-state ${item.status}`}>{item.status}</span></div>
                      <p>{item.reason}</p>
                      <small>{item.details}</small>
                      {item.sellerResponse && <blockquote><b>{locale === "tr" ? "Satıcı yanıtı" : "Seller response"}</b>{item.sellerResponse}</blockquote>}
                      {sameAddress(item.sellerAddress, accountAddress) && item.status === "open" && (
                        respondingDisputeId === item.id
                          ? <div className="dispute-response"><textarea value={sellerResponse} onChange={(event) => setSellerResponse(event.target.value)} maxLength={1000} placeholder={locale === "tr" ? "Alıcıya çözümünü açıkla…" : "Explain your resolution to the buyer…"} /><button onClick={() => respondToDispute(item)} disabled={!sellerResponse.trim()}>{locale === "tr" ? "İmzala ve yanıtla" : "Sign and respond"}</button></div>
                          : <button className="issue-button" onClick={() => setRespondingDisputeId(item.id)}>{locale === "tr" ? "Alıcıya yanıt ver" : "Respond to buyer"}</button>
                      )}
                      <time>{new Date(item.updatedAt).toLocaleString(locale)}</time>
                    </article>;
                  })}
                </div>
              ) : (
                <div className="empty-state compact">
                  <span>＋</span>
                  <h3>{studioTab === "listings" ? c.emptyStudioTitle : studioTab === "purchases" ? (locale === "tr" ? "Henüz satın alma yok" : "No purchases yet") : (locale === "tr" ? "Açık sorun yok" : "No open issues")}</h3>
                  <p>{studioTab === "listings" ? c.emptyStudioCopy : studioTab === "purchases" ? (locale === "tr" ? "Lisansladığın veri setleri burada görünecek." : "Licensed datasets will appear here.") : (locale === "tr" ? "Satın aldığın bir veri açıklamayla uyuşmazsa buradan talep açabilirsin." : "If purchased data differs from its description, you can open a request here.")}</p>
                  {studioTab === "listings" && <button onClick={() => setUploadOpen(true)}>{c.newDataset}</button>}
                </div>
              )}
            </div>
            <aside className="earnings-card">
              <div className="panel-head"><h2>{c.earnings}</h2><span>ALL</span></div>
              <strong>{lifetimeEarnings.toFixed(2)} <small>SUSD</small></strong>
              <p>{sellerSales.length ? (locale === "tr" ? `${sellerSales.length} doğrulanmış satış doğrudan cüzdanına ödendi.` : `${sellerSales.length} verified sales paid directly to your wallet.`) : (locale === "tr" ? "İlk satışından sonra kazancın burada görünecek." : "Your earnings will appear here after the first sale.")}</p>
              <div className="sales-mini-list">
                {sellerSales.slice(0, 4).map((sale) => <span key={sale.transactionHash}><b>{sale.datasetName}</b><em>+{sale.price} SUSD</em></span>)}
              </div>
              <div className="analytics-summary">
                <span><small>{locale === "tr" ? "Ortalama satış" : "Average sale"}</small><b>{sellerSales.length ? (lifetimeEarnings / sellerSales.length).toFixed(2) : "0.00"} SUSD</b></span>
                <span><small>{locale === "tr" ? "Şifreli ilanlar" : "Encrypted listings"}</small><b>{ownedDatasets.filter((item) => item.encryption).length}/{ownedDatasets.length}</b></span>
                <span><small>{locale === "tr" ? "Açık talepler" : "Open disputes"}</small><b>{disputes.filter((item) => item.status === "open" && sameAddress(item.sellerAddress, accountAddress)).length}</b></span>
              </div>
            </aside>
          </div>
        </section>
      )}

      {view === "activity" && (
        <section className="app-view">
          <div className="view-head activity-head">
            <div><p className="section-kicker">{c.activityKicker}</p><h1>{c.activityTitle}</h1><p>{c.activityCopy}</p></div>
            <span className="live-pill">
              {activityFeed.length
                ? `${activityFeed.length} ${locale === "tr" ? "CANLI OLAY" : "LIVE EVENTS"}`
                : c.waitingForDataset}
            </span>
          </div>
          <div className="network-map">
            <div className="map-grid" />
            <div className="map-orbit o1"><i /><i /><i /></div>
            <div className="map-orbit o2"><i /><i /><i /><i /></div>
            <div className="map-core"><span className="brand-mark"><i /><i /><i /></span><strong>SHELBY</strong><small>READY</small></div>
            <div className="map-stat one"><small>INDEXED DATA</small><strong>{verifiedBytes ? formatFileSize(verifiedBytes) : "0 B"}</strong></div>
            <div className="map-stat two"><small>ACTIVE DATASETS</small><strong>{activeDatasets.length}</strong></div>
            <div className="map-stat three"><small>ACTIVITY</small><strong>{activityFeed.length}</strong></div>
          </div>
          <div className="activity-layout">
            <div className="activity-feed">
              <div className="panel-head"><h2>{c.liveActivity}</h2><span>{activityFeed.length}</span></div>
              {activityFeed.length ? (
                activityFeed.map((item) => (
                  <div className="activity-row" key={item.id}>
                    <span className={`activity-icon ${item.transactionHash ? "a1" : ""}`}>
                      {item.transactionHash ? "↗" : "＋"}
                    </span>
                    <p><b>{item.name}</b><span>{item.action}</span></p>
                    <small>{item.time}</small>
                    {item.transactionHash ? (
                      <a
                        href={`https://explorer.aptoslabs.com/txn/${item.transactionHash}?network=shelbynet`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <code>{shortAddress(item.transactionHash)} ↗</code>
                      </a>
                    ) : (
                      <code>{item.value}</code>
                    )}
                  </div>
                ))
              ) : (
                <div className="empty-state compact">
                  <span>○</span>
                  <h3>{c.emptyActivityTitle}</h3>
                  <p>{c.emptyActivityCopy}</p>
                </div>
              )}
            </div>
            <aside className="network-health">
              <div className="panel-head"><h2>{c.networkHealth}</h2><span>{activeDatasets.length ? "LIVE" : "—"}</span></div>
              <div className="health-score"><strong>{integrityRate}<small>%</small></strong><span>Successful<br />verifications</span></div>
              <div className="health-line"><span>{c.storageProviders}</span><b>—</b></div>
              <div className="health-line"><span>{c.rpcLatency}</span><b>—</b></div>
              <div className="health-line"><span>{c.dataAvailability}</span><b>{activeDatasets.length ? "100%" : "—"}</b></div>
              <a href="https://explorer.shelby.xyz/shelbynet" target="_blank" rel="noreferrer">{c.openExplorer} ↗</a>
            </aside>
          </div>
        </section>
      )}

      <footer>
        <button className="brand" onClick={() => setView("explore")}>
          <span className="brand-mark"><i /><i /><i /></span>
          <span>Proof<span>Data</span></span>
        </button>
        <p>{c.footer}</p>
        <div><a href="https://docs.shelby.xyz/" target="_blank" rel="noreferrer">Shelby Docs</a><a href="https://explorer.shelby.xyz/shelbynet" target="_blank" rel="noreferrer">Explorer</a><span>{c.builtOn}</span></div>
      </footer>

      {selected && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
          <section className="detail-modal" role="dialog" aria-modal="true" aria-label={`${selected.name} details`}>
            <button className="modal-close" onClick={() => setSelected(null)}>×</button>
            <div className="detail-hero">
              <DataGlyph accent={selected.accent} />
              <div><div className="verified-line"><span>✓</span> {c.verifiedOn}</div><h2>{selected.name}</h2><p>{selected.description}</p></div>
            </div>
            <div className="detail-owner">
              <span className="avatar">{selected.ownerMark}</span><p><small>{c.maintainedBy}</small><strong>{selected.owner}</strong></p>
              <span className="score-ring">{trustScore(selected, saleActivities.filter((sale) => sale.datasetId === selected.id).length, selected.reports, reviewAverage(selected.id))}<small>TRUST</small></span>
            </div>
            <div className="detail-grid">
              <div className="preview-panel">
                <div className="panel-head">
                  <h3>{locale === "tr" ? "Gerçek önizleme" : "Actual preview"}</h3>
                  <span>
                    {selected.preview.kind === "table" && typeof selected.preview.rowCount === "number"
                      ? (locale === "tr" ? `${selected.preview.rowCount.toLocaleString()} satır` : `${selected.preview.rowCount.toLocaleString()} rows`)
                      : selected.format}
                  </span>
                </div>
                <DatasetPreviewPanel dataset={selected} locale={locale} />
              </div>
              <aside className="access-panel">
                <div className="price-line"><span><small>{c.commercialLicense}</small><strong>{selected.price === 0 ? c.openAccess : `${selected.price} ShelbyUSD`}</strong></span><em>{c.oneTime}</em></div>
                <button onClick={() => {
                  if (hasLicense(selected)) {
                    downloadDataset(selected);
                    return;
                  }
                  setPurchase(selected);
                  setSelected(null);
                  setTransactionHash("");
                  setWalletStatus("");
                }}>
                  {hasLicense(selected)
                    ? (locale === "tr" ? "Doğrulanmış dosyayı indir" : "Download verified file")
                    : c.licenseDataset} <span>→</span>
                </button>
                <p>{c.licenseIncludes}</p>
                <div className="license-badges">
                  <span className={selected.license.commercialUse ? "allowed" : "blocked"}>{selected.license.commercialUse ? "✓" : "×"} {locale === "tr" ? "Ticari kullanım" : "Commercial use"}</span>
                  <span className={selected.license.modelTraining ? "allowed" : "blocked"}>{selected.license.modelTraining ? "✓" : "×"} {locale === "tr" ? "Model eğitimi" : "Model training"}</span>
                  <span className={selected.license.redistribution ? "allowed" : "blocked"}>{selected.license.redistribution ? "✓" : "×"} {locale === "tr" ? "Yeniden dağıtım" : "Redistribution"}</span>
                  <span className={selected.license.updatesIncluded ? "allowed" : "blocked"}>{selected.license.updatesIncluded ? "✓" : "×"} {locale === "tr" ? "Güncellemeler" : "Updates"}</span>
                </div>
                <div className="access-row"><span>{c.records}</span><b>{selected.rows}</b></div>
                <div className="access-row"><span>{c.downloadSize}</span><b>{selected.size}</b></div>
                <div className="access-row"><span>Format</span><b>{selected.format}</b></div>
                <div className="access-row"><span>{locale === "tr" ? "Lisans" : "License"}</span><b>{selected.license.type}</b></div>
                <div className="access-row"><span>{locale === "tr" ? "Süre" : "Duration"}</span><b>{selected.license.duration}</b></div>
              </aside>
            </div>
            {downloadStatus && <p className="transaction-status">{downloadStatus}</p>}
            <div className="dataset-facts">
              <div><span>{locale === "tr" ? "Kaynak" : "Source"}</span><b>{selected.source}</b></div>
              <div><span>{locale === "tr" ? "Bölge" : "Geography"}</span><b>{selected.geography}</b></div>
              <div><span>{locale === "tr" ? "Dil" : "Language"}</span><b>{selected.language}</b></div>
              <div><span>{locale === "tr" ? "Güncelleme" : "Updates"}</span><b>{selected.updateFrequency}</b></div>
              <div><span>{locale === "tr" ? "Etiketler" : "Labels"}</span><b>{selected.labeled ? (locale === "tr" ? "Var" : "Included") : (locale === "tr" ? "Yok" : "None")}</b></div>
              <div><span>{locale === "tr" ? "Kişisel veri" : "Personal data"}</span><b>{selected.containsPersonalData ? (locale === "tr" ? "Beyan edildi" : "Declared") : (locale === "tr" ? "Yok" : "None declared")}</b></div>
              <div className="wide"><span>{locale === "tr" ? "Kullanım alanları" : "Use cases"}</span><b>{selected.useCases.join(" · ") || "—"}</b></div>
              <div className="wide"><span>{locale === "tr" ? "Güvenli teslimat" : "Secure delivery"}</span><b>{selected.encryption ? "AES-256-GCM · Shelby encrypted blob" : (locale === "tr" ? "Eski açık ilan" : "Legacy public listing")}</b></div>
            </div>
            <div className="integrity-panel">
              <div><span className="integrity-check">✓</span><p><strong>{locale === "tr" ? "Shelby taahhüdü kaydedildi" : "Shelby commitment recorded"}</strong><small>{locale === "tr" ? "Gösterilen kök, yayın sırasında dosyadan üretildi ve ShelbyNet ilanına yazıldı." : "The displayed root was generated from the file during publishing and recorded with the ShelbyNet listing."}</small></p></div>
              <code>{selected.root}</code>
              <a href="https://explorer.shelby.xyz/shelbynet" target="_blank" rel="noreferrer">{c.viewProof} ↗</a>
            </div>
            <div className="listing-meta-panel">
              <div>
                <strong>v{selected.version}</strong>
                <span>{selected.status === "active" ? (locale === "tr" ? "Satışta" : "Active") : (locale === "tr" ? "Satıştan kaldırıldı" : "Delisted")}</span>
              </div>
              <details>
                <summary>{locale === "tr" ? "Sürüm geçmişi" : "Version history"} ({selected.revisions.length})</summary>
                {selected.revisions.slice().reverse().map((revision) => (
                  <p key={revision.version}><b>v{revision.version}</b><span>{revision.name} · {revision.price} SUSD</span><small>{new Date(revision.updatedAt).toLocaleString(locale)}</small></p>
                ))}
              </details>
              <details>
                <summary>{locale === "tr" ? "Güven puanı nasıl hesaplandı?" : "How is the trust score calculated?"}</summary>
                <p><b>{trustScore(selected, saleActivities.filter((sale) => sale.datasetId === selected.id).length, selected.reports, reviewAverage(selected.id))}/100</b><span>{locale === "tr" ? "Shelby bütünlük kanıtı, şifreli teslimat, kaynak şeffaflığı, lisans bilgisi, satışlar, alıcı puanları ve bildirimler birlikte değerlendirilir." : "Shelby integrity, encrypted delivery, source transparency, licensing, sales, buyer ratings, and reports are evaluated together."}</span><small>{selected.reports} reports · {selected.views} views · {reviewAverage(selected.id).toFixed(1)}/5</small></p>
              </details>
              {!sameAddress(selected.ownerAddress, accountAddress) && (
                <button className="report-button" onClick={() => reportListing(selected)}>
                  {locale === "tr" ? "Bu ilanı bildir" : "Report this listing"}
                </button>
              )}
              {reportStatus && <small className="report-status">{reportStatus}</small>}
            </div>
            <div className="reviews-panel">
              <div className="panel-head"><h3>{locale === "tr" ? "Doğrulanmış alıcı yorumları" : "Verified buyer reviews"}</h3><span>{reviewAverage(selected.id) ? `${reviewAverage(selected.id).toFixed(1)}/5` : "—"}</span></div>
              {reviews.filter((review) => review.datasetId === selected.id).length ? reviews.filter((review) => review.datasetId === selected.id).map((review) => <article key={`${review.datasetId}:${review.reviewerAddress}`}><div><b>{"★".repeat(review.score)}{"☆".repeat(5 - review.score)}</b><small>{shortAddress(review.reviewerAddress)} · {new Date(review.createdAt).toLocaleDateString(locale)}</small></div><p>{review.comment}</p></article>) : <p className="review-empty">{locale === "tr" ? "Henüz doğrulanmış alıcı yorumu yok." : "No verified buyer reviews yet."}</p>}
              {connected && hasLicense(selected) && !sameAddress(selected.ownerAddress, accountAddress) && <div className="review-form">
                <select value={reviewScore} onChange={(event) => setReviewScore(Number(event.target.value))}><option value={5}>5 — Excellent</option><option value={4}>4 — Good</option><option value={3}>3 — Fair</option><option value={2}>2 — Poor</option><option value={1}>1 — Bad</option></select>
                <input value={reviewComment} maxLength={500} onChange={(event) => setReviewComment(event.target.value)} placeholder={locale === "tr" ? "Verinin kalitesini dürüstçe anlat…" : "Describe the data quality honestly…"} />
                <button onClick={() => submitReview(selected)} disabled={!reviewComment.trim()}>{locale === "tr" ? "İmzala ve yayımla" : "Sign and publish"}</button>
              </div>}
              {reviewStatus && <small className="report-status">{reviewStatus}</small>}
            </div>
          </section>
        </div>
      )}

      {walletPickerOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setWalletPickerOpen(false);
        }}>
          <section className="wallet-modal" role="dialog" aria-modal="true" aria-label={c.chooseWallet}>
            <button className="modal-close" onClick={() => setWalletPickerOpen(false)}>×</button>
            <span className="purchase-icon">◈</span>
            <p className="section-kicker">SHELBYNET</p>
            <h2>{c.chooseWallet}</h2>
            <div className="wallet-list">
              {wallets.map((item) => (
                <button key={item.name} onClick={() => connectWallet(item.name)}>
                  <img src={item.icon} alt="" />
                  <span>{item.name}</span>
                  <b>→</b>
                </button>
              ))}
            </div>
            {!wallets.length && (
              <p className="wallet-warning">
                {c.walletUnavailable}{" "}
                <a href="https://petra.app/" target="_blank" rel="noreferrer">Petra ↗</a>
              </p>
            )}
          </section>
        </div>
      )}

      {purchase && (
        <div className="modal-backdrop">
          <section className="purchase-modal" role="dialog" aria-modal="true" aria-label="License dataset">
            <button className="modal-close" onClick={() => setPurchase(null)}>×</button>
            <span className="purchase-icon">◇</span>
            <p className="section-kicker">{c.dataLicense}</p>
            <h2>{purchase.name}</h2>
            <p>{c.licenseSummary}</p>
            <div className="license-summary-card">
              <b>{purchase.license.type} · {purchase.license.duration}</b>
              <span>{purchase.license.commercialUse ? "✓" : "×"} {locale === "tr" ? "Ticari kullanım" : "Commercial use"}</span>
              <span>{purchase.license.modelTraining ? "✓" : "×"} {locale === "tr" ? "AI model eğitimi" : "AI model training"}</span>
              <span>{purchase.license.redistribution ? "✓" : "×"} {locale === "tr" ? "Yeniden dağıtım" : "Redistribution"}</span>
              <small>{locale === "tr" ? "Lisans, satın alan cüzdan ve işlem kimliğiyle kalıcı olarak kaydedilir." : "The license is permanently recorded with the buyer wallet and transaction ID."}</small>
            </div>
            <div className="receipt"><span>{c.datasetLicense}</span><b>{purchase.price || 0} SUSD</b><span>{locale === "tr" ? "Testnet platform ücreti" : "Testnet platform fee"}</span><b>0 SUSD</b><strong>{c.total}</strong><strong>{purchase.price.toFixed(2)} SUSD</strong></div>
            {!connected ? (
              <button className="primary-wide" onClick={openWalletPicker}>{c.connectContinue}</button>
            ) : (
              <button
                className="primary-wide"
                onClick={submitLicensePayment}
                disabled={transactionBusy || walletStatus === c.transactionSuccess}
              >
                {transactionBusy ? c.confirmInWallet : c.confirmLicense} <span>→</span>
              </button>
            )}
            {walletStatus && <p className={`transaction-status ${transactionHash ? "submitted" : ""}`}>{walletStatus}</p>}
            {transactionHash && (
              <a
                className="transaction-link"
                href={`https://explorer.aptoslabs.com/txn/${transactionHash}?network=shelbynet`}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddress(transactionHash)} · Aptos Explorer ↗
              </a>
            )}
            <small className="secure-note">✓ {c.realTransaction}</small>
          </section>
        </div>
      )}

      {disputeDataset && (
        <div className="modal-backdrop">
          <section className="manage-modal dispute-modal" role="dialog" aria-modal="true" aria-label="Report a dataset issue">
            <button className="modal-close" onClick={() => setDisputeDataset(null)}>×</button>
            <p className="section-kicker">{locale === "tr" ? "ALICI KORUMASI" : "BUYER PROTECTION"}</p>
            <h2>{locale === "tr" ? "Sorun veya iade talebi" : "Issue or refund request"}</h2>
            <p><b>{disputeDataset.name}</b> · {locale === "tr" ? "Talep cüzdan imzanla doğrulanır ve satıcıya görünür." : "Your request is wallet-signed and visible to the seller."}</p>
            <div className="listing-form">
              <label><span>{locale === "tr" ? "Sorun türü" : "Issue type"}</span><select value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)}><option>Dataset differs from description</option><option>Missing or corrupt files</option><option>License problem</option><option>Personal data concern</option><option>Refund request</option></select></label>
              <label><span>{locale === "tr" ? "Açıklama ve kanıt" : "Details and evidence"}</span><textarea rows={5} maxLength={1000} value={disputeDetails} onChange={(event) => setDisputeDetails(event.target.value)} placeholder={locale === "tr" ? "Beklediğin ile aldığın arasındaki farkı açıkça yaz." : "Explain what you expected and what you received."} /></label>
            </div>
            <button className="primary-wide" disabled={!disputeDetails.trim()} onClick={submitDispute}>{locale === "tr" ? "Talebi imzala ve gönder" : "Sign and submit request"}</button>
            {disputeStatus && <p className="transaction-status">{disputeStatus}</p>}
            <small className="secure-note">✓ {locale === "tr" ? "Testnet’te otomatik para iadesi yoktur; talepler satıcı yanıtı ve manuel inceleme için kaydedilir." : "Testnet refunds are not automatic; requests are recorded for seller response and manual review."}</small>
          </section>
        </div>
      )}

      {manageListing && (
        <div className="modal-backdrop">
          <section className="manage-modal" role="dialog" aria-modal="true" aria-label="Manage listing">
            <button className="modal-close" onClick={() => setManageListing(null)} disabled={manageBusy}>×</button>
            <p className="section-kicker">{locale === "tr" ? "SAHİP KONTROLÜ" : "OWNER CONTROL"}</p>
            <h2>{locale === "tr" ? "İlanı yönet" : "Manage listing"}</h2>
            <p>{locale === "tr" ? "Her değişiklik Petra imzasıyla doğrulanır ve sürüm geçmişine eklenir." : "Every change is verified with a Petra signature and added to version history."}</p>
            <div className="listing-form">
              <label><span>{locale === "tr" ? "Başlık" : "Title"}</span><input value={manageName} onChange={(event) => setManageName(event.target.value)} maxLength={120} /></label>
              <label><span>{locale === "tr" ? "Açıklama" : "Description"}</span><textarea value={manageDescription} onChange={(event) => setManageDescription(event.target.value)} maxLength={500} rows={3} /></label>
              <div className="listing-form-row">
                <label><span>{locale === "tr" ? "Kategori" : "Category"}</span><select value={manageCategory} onChange={(event) => setManageCategory(event.target.value)}>{["Language", "Vision", "Onchain", "Mobility", "Climate", "Finance"].map((item) => <option key={item}>{item}</option>)}</select></label>
                <label><span>{locale === "tr" ? "Fiyat (ShelbyUSD)" : "Price (ShelbyUSD)"}</span><input type="number" min="0" step="0.01" value={managePrice} onChange={(event) => setManagePrice(event.target.value)} /></label>
              </div>
            </div>
            <div className="manage-actions">
              <button className="primary-wide" onClick={() => manageListingAction("update")} disabled={manageBusy || !manageName.trim() || !manageDescription.trim() || !managePrice}>
                {manageBusy ? (locale === "tr" ? "Petra bekleniyor…" : "Waiting for Petra…") : (locale === "tr" ? "Değişiklikleri imzala ve kaydet" : "Sign and save changes")}
              </button>
              <button className={manageListing.status === "active" ? "danger-button" : "secondary-button"} onClick={() => manageListingAction(manageListing.status === "active" ? "deactivate" : "reactivate")} disabled={manageBusy}>
                {manageListing.status === "active" ? (locale === "tr" ? "Satıştan kaldır" : "Delist") : (locale === "tr" ? "Yeniden satışa aç" : "Relist")}
              </button>
            </div>
            <button className="version-button" onClick={() => beginNewVersion(manageListing)} disabled={manageBusy}>
              ＋ {locale === "tr" ? "Yeni veri dosyası sürümü yayınla" : "Publish a new data-file version"}
            </button>
            {manageStatus && <p className="transaction-status">{manageStatus}</p>}
            <small className="secure-note">✓ {locale === "tr" ? "Yalnızca yayıncı cüzdanı değiştirebilir" : "Only the publisher wallet can make changes"}</small>
          </section>
        </div>
      )}

      {uploadOpen && (
        <div className="modal-backdrop">
          <section className="upload-modal" role="dialog" aria-modal="true" aria-label="Publish a dataset">
            <button className="modal-close" onClick={closeUpload} disabled={uploadBusy}>×</button>
            {!uploadFile ? (
              <>
                <p className="section-kicker">{c.creatorWorkflow}</p>
                <h2>{previousDatasetId ? (locale === "tr" ? "Yeni veri sürümünü seç" : "Choose the new data version") : c.publishVerified}</h2>
                <p>{c.publishCopy}</p>
                <label className="drop-zone">
                  <input type="file" onChange={(event) => selectUploadFile(event.target.files?.[0] ?? null)} />
                  <span>↑</span>
                  <strong>{c.dropDataset}</strong>
                   <small>CSV, JSONL, PARQUET, ZIP · up to 100 MB</small>
                  <em>{c.chooseFile}</em>
                </label>
                <div className="upload-features"><span>✓ File inspection</span><span>✓ Content fingerprint</span><span>✓ Shelby commitment</span></div>
              </>
            ) : (
              <>
                <p className="section-kicker">{c.committing}</p>
                <h2>{c.readyPublish}</h2>
                <div className="file-ready"><span>▦</span><p><strong>{uploadFile.name}</strong><small>{formatFileSize(uploadFile.size)}</small></p><b>✓</b></div>
                <div className="listing-form">
                  <label>
                    <span>{locale === "tr" ? "Veri setinin adı" : "Dataset name"}</span>
                    <input
                      value={listingName}
                      onChange={(event) => setListingName(event.target.value)}
                      placeholder={locale === "tr" ? "Örn. Türkçe kedi görselleri" : "e.g. Turkish cat images"}
                      disabled={uploadBusy}
                    />
                  </label>
                  <label>
                    <span>{locale === "tr" ? "Açıklama" : "Description"}</span>
                    <textarea
                      value={listingDescription}
                      onChange={(event) => setListingDescription(event.target.value)}
                      placeholder={locale === "tr" ? "Alıcı bu veriyi neden alsın?" : "Why should a buyer license this data?"}
                      rows={3}
                      disabled={uploadBusy}
                    />
                  </label>
                  <div className="listing-form-row">
                    <label>
                      <span>{locale === "tr" ? "Kategori" : "Category"}</span>
                      <select
                        value={listingCategory}
                        onChange={(event) => setListingCategory(event.target.value)}
                        disabled={uploadBusy}
                      >
                        {["Language", "Vision", "Onchain", "Mobility", "Climate", "Finance"].map((item) => (
                          <option value={item} key={item}>{categoryLabel(item)}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{locale === "tr" ? "Satış fiyatın" : "Your sale price"}</span>
                      <div className="price-input">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={listingPrice}
                          onChange={(event) => setListingPrice(event.target.value.replace(/[^0-9.,]/g, ""))}
                          placeholder="5"
                          disabled={uploadBusy}
                        />
                        <b>SUSD</b>
                      </div>
                    </label>
                  </div>
                  <div className="form-section-title">
                    <strong>{locale === "tr" ? "Veri şeffaflığı" : "Data transparency"}</strong>
                    <span>{locale === "tr" ? "Alıcının kaliteyi değerlendirebilmesi için" : "Helps buyers evaluate quality"}</span>
                  </div>
                  <label>
                    <span>{locale === "tr" ? "Veri kaynağı" : "Data source"}</span>
                    <input value={listingSource} onChange={(event) => setListingSource(event.target.value)} placeholder={locale === "tr" ? "Örn. izinli saha çekimleri" : "e.g. consented field collection"} disabled={uploadBusy} />
                  </label>
                  <div className="listing-form-row">
                    <label><span>{locale === "tr" ? "Ülke / bölge" : "Country / region"}</span><input value={listingGeography} onChange={(event) => setListingGeography(event.target.value)} disabled={uploadBusy} /></label>
                    <label><span>{locale === "tr" ? "Veri dili" : "Dataset language"}</span><input value={listingLanguage} onChange={(event) => setListingLanguage(event.target.value)} disabled={uploadBusy} /></label>
                  </div>
                  <div className="listing-form-row">
                    <label><span>{locale === "tr" ? "Toplanma başlangıcı" : "Collection start"}</span><input type="date" value={listingCollectedFrom} onChange={(event) => setListingCollectedFrom(event.target.value)} disabled={uploadBusy} /></label>
                    <label><span>{locale === "tr" ? "Toplanma bitişi" : "Collection end"}</span><input type="date" value={listingCollectedTo} onChange={(event) => setListingCollectedTo(event.target.value)} disabled={uploadBusy} /></label>
                  </div>
                  <label>
                    <span>{locale === "tr" ? "Kullanım alanları (virgülle ayır)" : "Use cases (comma separated)"}</span>
                    <input value={listingUseCases} onChange={(event) => setListingUseCases(event.target.value)} placeholder={locale === "tr" ? "Görüntü sınıflandırma, değerlendirme, araştırma" : "Image classification, evaluation, research"} disabled={uploadBusy} />
                  </label>
                  <div className="listing-form-row">
                    <label><span>{locale === "tr" ? "Güncelleme sıklığı" : "Update frequency"}</span><select value={listingUpdateFrequency} onChange={(event) => setListingUpdateFrequency(event.target.value)} disabled={uploadBusy}><option>One-time</option><option>Monthly</option><option>Quarterly</option><option>Yearly</option></select></label>
                    <label><span>{locale === "tr" ? "Lisans türü" : "License type"}</span><select value={licenseType} onChange={(event) => setLicenseType(event.target.value)} disabled={uploadBusy}><option>Commercial</option><option>Research</option><option>Personal</option><option>Custom</option></select></label>
                  </div>
                  <div className="check-grid">
                    <label><input type="checkbox" checked={listingLabeled} onChange={(event) => setListingLabeled(event.target.checked)} /> {locale === "tr" ? "Veri etiketli" : "Data is labeled"}</label>
                    <label><input type="checkbox" checked={listingContainsPii} onChange={(event) => setListingContainsPii(event.target.checked)} /> {locale === "tr" ? "Kişisel veri içeriyor" : "Contains personal data"}</label>
                    <label><input type="checkbox" checked={licenseCommercial} onChange={(event) => setLicenseCommercial(event.target.checked)} /> {locale === "tr" ? "Ticari kullanım" : "Commercial use"}</label>
                    <label><input type="checkbox" checked={licenseTraining} onChange={(event) => setLicenseTraining(event.target.checked)} /> {locale === "tr" ? "Model eğitimi" : "Model training"}</label>
                    <label><input type="checkbox" checked={licenseRedistribution} onChange={(event) => setLicenseRedistribution(event.target.checked)} /> {locale === "tr" ? "Yeniden dağıtım" : "Redistribution"}</label>
                    <label><input type="checkbox" checked={licenseUpdates} onChange={(event) => setLicenseUpdates(event.target.checked)} /> {locale === "tr" ? "Sürüm güncellemeleri" : "Version updates"}</label>
                  </div>
                  <label><span>{locale === "tr" ? "Lisans süresi" : "License duration"}</span><select value={licenseDuration} onChange={(event) => setLicenseDuration(event.target.value)} disabled={uploadBusy}><option>Perpetual</option><option>1 year</option><option>6 months</option><option>Custom</option></select></label>
                  <div className="encryption-notice">
                    <b>🔒 {locale === "tr" ? "Şifreli teslimat açık" : "Encrypted delivery enabled"}</b>
                    <span>{locale === "tr" ? "Dosya tarayıcında AES-256-GCM ile şifrelenir. Satın almayan kişi Shelby’deki dosyayı açamaz." : "The file is encrypted in your browser with AES-256-GCM. Unlicensed visitors cannot open the Shelby file."}</span>
                  </div>
                  <p className="price-explainer">
                    {locale === "tr"
                      ? "Bu, alıcının sana ödeyeceği fiyattır. Shelby depolama ücreti bundan ayrıdır. Ücretsiz yayın için 0 yaz."
                      : "This is what the buyer pays you. Shelby storage cost is separate. Enter 0 for free access."}
                  </p>
                </div>
                <button className="primary-wide" onClick={publishDataset} disabled={uploadBusy}>
                  {uploadBusy
                    ? (locale === "tr" ? "Yayınlanıyor…" : "Publishing…")
                    : c.publishTestnet}{" "}
                  <span>→</span>
                </button>
                {uploadStatus && (
                  <p className={`transaction-status ${uploadTransactionHash ? "submitted" : ""}`}>
                    {uploadStatus}
                  </p>
                )}
                {uploadStatus && !uploadBusy && !uploadStatus.startsWith("Yayınlandı") && !uploadStatus.startsWith("Published") && (
                  <a
                    className="upload-help"
                    href="https://docs.shelby.xyz/apis/faucet/shelbyusd"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {locale === "tr" ? "APT / ShelbyUSD Faucet’i aç ↗" : "Open the APT / ShelbyUSD Faucet ↗"}
                  </a>
                )}
                {uploadTransactionHash && (
                  <a
                    className="transaction-link"
                    href={`https://explorer.aptoslabs.com/txn/${uploadTransactionHash}?network=shelbynet`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(uploadTransactionHash)} · Aptos Explorer ↗
                  </a>
                )}
                <small className="secure-note">{c.reviewTerms}</small>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
