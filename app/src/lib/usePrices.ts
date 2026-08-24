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
 *
 * One fetch and one timer for the whole app, however many components
 * call this. The naive version - state and an interval per hook - meant
 * a second consumer doubled the polling and started from a blank price,
 * flashing an em dash before its first response landed even though the
 * answer was already on screen in the footer. Subscribers share the last
 * result, so a component mounting later renders the price immediately.
 *
 * The timer only runs while something is listening: the last unmount
 * clears it.
 */
let cache: Prices = { sol: null, ansem: null };
const subscribers = new Set<(p: Prices) => void>();
let timer: number | null = null;

const loadPrices = async () => {
  try {
    const res = await fetch(
      `https://api.jup.ag/price/v3?ids=${SOL_MINT},${ANSEM_MINT}`
    );
    if (!res.ok) return;
    const data = await res.json();
    cache = {
      sol: data[SOL_MINT]?.usdPrice ?? null,
      ansem: data[ANSEM_MINT]?.usdPrice ?? null,
    };
    subscribers.forEach((fn) => fn(cache));
  } catch {
    /* keep the last known prices on a transient failure */
  }
};

export const usePrices = (): Prices => {
  const [prices, setPrices] = useState<Prices>(cache);

  useEffect(() => {
    subscribers.add(setPrices);
    if (timer === null) {
      loadPrices();
      timer = window.setInterval(loadPrices, REFRESH_MS);
    }
    return () => {
      subscribers.delete(setPrices);
      if (subscribers.size === 0 && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
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

/**
 * A token amount rendered as its USD value, for showing beside the
 * figure itself. Returns null when the price has not arrived yet or the
 * amount is unknown, so callers render nothing rather than "$0.00" -
 * a wrong number reads as real, a missing one reads as loading.
 *
 * `amount` is in whole tokens, not base units: convert with toUi first.
 */
export const usdValue = (
  amount: number | null | undefined,
  price: number | null
): string | null => {
  if (amount == null || price == null) return null;
  const v = amount * price;
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};
