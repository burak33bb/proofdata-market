"use client";

import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { Network } from "@aptos-labs/ts-sdk";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AptosWalletAdapterProvider
      autoConnect
      optInWallets={["Petra", "Petra Web"]}
      dappConfig={{ network: Network.SHELBYNET }}
      onError={(error) => console.error("Aptos wallet error", error)}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}
