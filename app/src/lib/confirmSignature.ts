import type { Connection, TransactionSignature } from "@solana/web3.js";

/**
 * Waits for a transaction to land, purely over HTTP polling.
 *
 * `connection.confirmTransaction()` - every variant of it, including the
 * blockhash+lastValidBlockHeight strategy this app used to rely on -
 * races an `onSignature` WebSocket subscription against its own polling.
 * The fast path (the WS one) never resolves on this app's RPC (a
 * same-origin HTTP-only proxy, see api/rpc.ts), and worse, the *slow*
 * path's own REST fallback is gated behind that same subscription
 * reaching a "subscribed" state - so it never runs either. All that's
 * left running is the independent blockheight-expiry clock, which fires
 * after ~60-90s regardless of whether the transaction actually landed
 * seconds earlier. That's a false "expired" report on a transaction
 * that likely succeeded - confusing at best, and actively wrong.
 *
 * This polls `getSignatureStatuses` directly on a short interval and
 * checks blockheight expiry itself, so it never depends on a socket
 * that can't connect.
 */
export async function confirmSignature(
  connection: Connection,
  signature: TransactionSignature,
  lastValidBlockHeight: number,
  commitment: "confirmed" | "finalized" = "confirmed"
): Promise<void> {
  const rank = { processed: 0, confirmed: 1, finalized: 2 } as const;
  const target = rank[commitment];

  while (true) {
    const { value: statuses } = await connection.getSignatureStatuses([signature]);
    const status = statuses[0];

    if (status?.err) {
      throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus &&
      rank[status.confirmationStatus as keyof typeof rank] >= target
    ) {
      return;
    }

    const currentHeight = await connection.getBlockHeight("processed").catch(() => -1);
    if (currentHeight > lastValidBlockHeight) {
      throw new Error(
        `Transaction ${signature} expired: block height exceeded before it confirmed. ` +
          `It may or may not have landed - check the signature on an explorer before retrying.`
      );
    }

    await new Promise((r) => setTimeout(r, 1000));
  }
}
