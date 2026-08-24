/**
 * Client half of the Magic Eden integration.
 *
 * Every call goes through /api/magiceden so the API key stays on the
 * server. The endpoints return an unsigned transaction, which the
 * connected wallet signs and the caller sends.
 *
 * Untested against a live marketplace: Magic Eden's devnet API has been
 * decommissioned, so this can only be exercised on mainnet.
 */
import { Transaction, VersionedTransaction } from "@solana/web3.js";

const AUCTION_HOUSE = "E8cU1WiRWjanGxmn96ewBgk9vPTcL6AEZ1t6F6fkgUWe";

type Params = Record<string, string | number>;

async function call(endpoint: string, params: Params) {
  const q = new URLSearchParams({ endpoint });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));

  const res = await fetch(`/api/magiceden?${q}`);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error ?? body?.message ?? `magic eden: ${res.status}`);
  }
  return body as { tx?: { data: number[] }; txSigned?: { data: number[] } };
}

/** Turns Magic Eden's byte array into something a wallet can sign. */
function decode(body: { tx?: { data: number[] }; txSigned?: { data: number[] } }) {
  const raw = body.txSigned?.data ?? body.tx?.data;
  if (!raw) throw new Error("magic eden returned no transaction");
  const bytes = Uint8Array.from(raw);
  // Versioned transactions start with a byte that has the high bit set;
  // legacy ones begin with a signature count that never does.
  return (bytes[0] & 0x80) !== 0
    ? VersionedTransaction.deserialize(bytes)
    : Transaction.from(bytes);
}

/** List a piece for sale. */
export const listForSale = async (a: {
  seller: string;
  tokenMint: string;
  tokenAccount: string;
  priceSol: number;
}) =>
  decode(
    await call("instructions/sell", {
      seller: a.seller,
      auctionHouseAddress: AUCTION_HOUSE,
      tokenMint: a.tokenMint,
      tokenAccount: a.tokenAccount,
      price: a.priceSol,
    })
  );

/** Buy a listed piece outright. */
export const buyNow = async (a: {
  buyer: string;
  seller: string;
  tokenMint: string;
  tokenATA: string;
  priceSol: number;
}) =>
  decode(
    await call("instructions/buy-now", {
      buyer: a.buyer,
      seller: a.seller,
      auctionHouseAddress: AUCTION_HOUSE,
      tokenMint: a.tokenMint,
      tokenATA: a.tokenATA,
      price: a.priceSol,
    })
  );

/** Cancel one of your own listings. */
export const cancelListing = async (a: {
  seller: string;
  tokenMint: string;
  tokenAccount: string;
  priceSol: number;
}) =>
  decode(
    await call("instructions/sell-cancel", {
      seller: a.seller,
      auctionHouseAddress: AUCTION_HOUSE,
      tokenMint: a.tokenMint,
      tokenAccount: a.tokenAccount,
      price: a.priceSol,
    })
  );
