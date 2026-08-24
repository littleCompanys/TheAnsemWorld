import type { AnchorProvider } from "@coral-xyz/anchor";
import type { Transaction } from "@solana/web3.js";
import { confirmSignature } from "./confirmSignature";

/**
 * Runs a write the way that actually completes on this app's RPC setup,
 * and logs how long each phase took so a slow action (e.g. "it takes 20s
 * before Phantom even shows the approval screen") can be pinned to a
 * specific phase from the browser console instead of guessed at.
 *
 * Takes `.transaction()` rather than `.rpc()` deliberately, for two
 * reasons:
 *
 *  1. Anchor's own `.rpc()` confirms via `connection.confirmTransaction()`,
 *     and EVERY strategy that method offers - including the
 *     blockhash+lastValidBlockHeight one this file used to pass - races
 *     an `onSignature` WebSocket subscription against its own polling.
 *     This app's RPC is a same-origin HTTP-only proxy (see api/rpc.ts),
 *     so that subscription never reaches "subscribed", and the REST
 *     fallback check inside that same race is gated behind it - it never
 *     runs either. All that's left running is an independent blockheight
 *     clock, which reports "expired" after ~60-90s regardless of whether
 *     the transaction actually landed seconds earlier. That produced a
 *     real, confusing false negative: a mint that succeeded on-chain,
 *     reported to the user as failed. `confirmSignature()` below polls
 *     `getSignatureStatuses` directly instead, so it never depends on a
 *     socket that can't connect and never misses a fast confirmation.
 *
 *  2. `.transaction()` runs Anchor's account-resolution step and returns
 *     before ever touching the wallet, so timing it in isolation tells
 *     us definitively whether a slow approval popup is our own code
 *     taking a while to build the transaction, or the wallet itself
 *     (its own RPC, its own simulate-before-showing-the-popup step)
 *     taking a while once we've already handed the transaction over -
 *     two very different problems with very different fixes.
 */
export async function rpcSafe(
  builder: { transaction: () => Promise<Transaction> },
  provider: AnchorProvider,
  label = "rpc"
): Promise<string> {
  const t0 = performance.now();

  const tx = await builder.transaction();
  const t1 = performance.now();

  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = provider.wallet.publicKey;
  const t2 = performance.now();

  const signed = await provider.wallet.signTransaction(tx);
  const t3 = performance.now();

  const signature = await provider.connection.sendRawTransaction(
    signed.serialize(),
    { skipPreflight: false, preflightCommitment: "confirmed" }
  );
  const t4 = performance.now();

  await confirmSignature(provider.connection, signature, lastValidBlockHeight);
  const t5 = performance.now();

  const ms = (a: number, b: number) => Math.round(b - a);
  console.log(
    `[rpcSafe:${label}] build ${ms(t0, t1)}ms · blockhash ${ms(t1, t2)}ms · ` +
      `wallet sign ${ms(t2, t3)}ms · send ${ms(t3, t4)}ms · confirm ${ms(t4, t5)}ms · ` +
      `total ${ms(t0, t5)}ms`
  );

  return signature;
}
