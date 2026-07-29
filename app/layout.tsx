import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${protocol}://${host}` : "https://proofdata.openai-sites.com";
  const image = `${origin}/og.png`;

  return {
    title: "ProofData AI Market — Verified datasets on Shelby",
    description:
      "Discover, verify, and license production-grade AI datasets, cryptographically anchored on Shelby.",
    openGraph: {
      title: "ProofData AI Market — The verifiable data layer for AI",
      description:
        "Production-grade datasets with cryptographic integrity, agent-native licensing, and Shelby-speed retrieval.",
      type: "website",
      images: [{ url: image, width: 1664, height: 936, alt: "ProofData — Trusted data. Ready for intelligence." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "ProofData AI Market — The verifiable data layer for AI",
      description:
        "Trusted datasets. Transparent provenance. Ready for intelligent systems.",
      images: [image],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
