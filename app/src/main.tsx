import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { Buffer } from "buffer";
import App from "./App";
import { ToastProvider } from "./components/Toast";

import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles.css";

// Solana libraries assume Node's Buffer, which browsers do not have.
(globalThis as any).Buffer = (globalThis as any).Buffer ?? Buffer;

// Production goes through /api/rpc (see app/api/rpc.ts) so the real RPC
// URL - which carries a paid API key on mainnet - never reaches the
// browser bundle. @solana/web3.js Connection requires a full URL
// (http/https), so we resolve the relative path against the page origin.
// A plain `vite dev` has no serverless functions running to answer that
// route, so local dev keeps talking to VITE_RPC_ENDPOINT (or a local
// validator) directly; nothing there is secret enough to matter.
const ENDPOINT = import.meta.env.PROD
  ? `${window.location.origin}/api/rpc`
  : (import.meta.env.VITE_RPC_ENDPOINT ?? "http://127.0.0.1:8899");

function Root() {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={ENDPOINT} config={{ commitment: "processed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <BrowserRouter>
            <ToastProvider>
              <App />
            </ToastProvider>
          </BrowserRouter>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
