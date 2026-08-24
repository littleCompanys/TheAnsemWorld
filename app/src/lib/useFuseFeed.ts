import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getProgram, fuseFeedPda } from "./program";
import { useProvider } from "./useAnsem";

export type FuseFeedItem = {
  survivor: PublicKey;
  absorbed: PublicKey;
  ansemwBurned: number;
  slot: number;
  parts: number;
};

/**
 * The public fuse history, read straight off one PDA.
 *
 * Decoding goes through Anchor's own coder rather than manual byte
 * offsets: the account layout is the IDL's business, and hand-written
 * offsets silently return garbage the moment a field moves.
 */
export const useFuseFeed = (refreshKey = 0) => {
  const provider = useProvider();
  const [items, setItems] = useState<FuseFeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!provider) return;
      setLoading(true);
      try {
        const program = getProgram(provider);
        const feed = await (program.account as any).fuseFeed.fetchNullable(
          fuseFeedPda()
        );

        if (!feed) {
          if (!cancelled) {
            setItems([]);
            setTotal(0);
          }
          return;
        }

        const entries = feed.entries as any[];
        const len = entries.length;
        const count = Math.min(Number(feed.total), len);
        const nextIndex = Number(feed.nextIndex);

        // Walk backwards from the write head so newest comes first.
        const recent: FuseFeedItem[] = [];
        for (let k = 1; k <= count; k++) {
          const e = entries[(nextIndex - k + len) % len];
          recent.push({
            survivor: e.survivor,
            absorbed: e.absorbed,
            ansemwBurned: Number(e.ansemwBurned),
            slot: Number(e.slot),
            parts: Number(e.parts),
          });
        }

        if (!cancelled) {
          setItems(recent);
          setTotal(Number(feed.total));
        }
      } catch (e) {
        console.error("useFuseFeed", e);
        if (!cancelled) {
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provider, refreshKey]);

  return { items, total, loading };
};
