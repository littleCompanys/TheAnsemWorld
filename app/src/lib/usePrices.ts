import { useEffect, useState } from "react";

/** Wrapped SOL mint - Jupiter prices SOL through this address. */
const SOL_MINT = "So11111111111111111111111111111111111111112";
/** $ANSEM on pump.fun (mainnet) - the real reward token, priced regardless
 * of which cluster this site's RPC points at. */
const ANSEM_MINT = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";

const REFRESH_MS = 60_000;

export type Prices = {
  sol: number | null;
  ansem: number | null;
};

/**
 * Live USD prices for the footer price bar. Jupiter's price API is public
 * (no key) and CORS-open, so this calls it directly from the browser -
 * unrelated to the Solana RPC the rest of the app uses, so it adds no
 * load there.
 */
export const usePrices = (): Prices => {
  const [prices, setPrices] = useState<Prices>({ sol: null, ansem: null });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(
          `https://api.jup.ag/price/v3?ids=${SOL_MINT},${ANSEM_MINT}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setPrices({
          sol: data[SOL_MINT]?.usdPrice ?? null,
          ansem: data[ANSEM_MINT]?.usdPrice ?? null,
        });
      } catch {
        /* keep the last known prices on a transient failure */
      }
    };

    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return prices;
};

/** $0.2751 -> "$0.2751"; $93.84 -> "$93.84". Small prices need more
 * decimals to not read as "$0.00". */
export const fmtUsd = (n: number | null): string => {
  if (n == null) return "—";
  const digits = n < 1 ? 4 : 2;
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
};
