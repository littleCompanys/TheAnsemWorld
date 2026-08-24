import { useCallback, useEffect, useMemo, useState } from "react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  getProgram,
  configPda,
  rewardStatePda,
  rewardVaultPda,
  positionPda,
  decodeConfig,
  decodePosition,
  decodeStakeAccount,
  MPL_CORE_PROGRAM_ID,
  type Config,
  type Position,
  type StakeAccount,
  type AnsemProgram,
} from "./program";

export const useProvider = () => {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  return useMemo(() => {
    if (!wallet) return null;
    return new AnchorProvider(connection, wallet, {
      commitment: "processed",
      preflightCommitment: "processed",
    });
  }, [connection, wallet]);
};

/**
 * Read-only program handle.
 *
 * Deliberately built on a dummy wallet even when a real one is
 * connected, so its identity depends on the connection alone. Reads do
 * not care who is asking, and memoising on the wallet made every hook
 * keyed to this handle re-run each time the adapter changed state while
 * connecting - useProtocol was measured running four times on a single
 * page load, at roughly six RPC calls each.
 *
 * Writes never come through here; they build their own provider via
 * useProvider(), which does require a real wallet.
 */
export const useProgram = (): AnsemProgram | null => {
  const { connection } = useConnection();
  return useMemo(() => {
    const provider = new AnchorProvider(
      connection,
      { publicKey: PublicKey.default } as any,
      { commitment: "processed", preflightCommitment: "processed" }
    );
    try {
      return getProgram(provider);
    } catch {
      return null;
    }
  }, [connection]);
};

export type ProtocolStats = {
  config: Config | null;
  totalWeight: number;
  accRewardPerWeight: string;
  totalAllocated: number;
  totalClaimed: number;
  vaultBalance: number;
  /** Null unless the caller asked for the position scan - see below. */
  positionCount: number | null;
  activeCount: number | null;
  /** Sum of cumulative $ANSEMW burned across every position. */
  totalAnsemwBurned: number | null;
  /** NFTs destroyed by fuse (= sum of absorbed_count). */
  nftsBurned: number | null;
  /**
   * Which token program owns each mint. Read from the mint accounts
   * rather than assumed: $ANSEM on mainnet is Token-2022, and the two
   * tokens need not agree. Every instruction that moves one of them
   * has to be handed the matching program, so this travels with the
   * config instead of being hardcoded at each call site.
   */
  ansemTokenProgram: PublicKey;
  ansemwTokenProgram: PublicKey;
  initialized: boolean;
};

/**
 * Protocol-wide state.
 *
 * `withPositions` gates a scan of every Position account, which is the
 * only expensive call here and the only source of the four collection
 * counters. Seven of the nine pages using this hook need none of them -
 * they want the config and the token programs - and were downloading
 * the whole collection to ignore it. Harmless at seven pieces, roughly
 * 830KB per page load at 3,333, on every visit.
 *
 * The counters read null when the scan was skipped, rather than zero:
 * a page that starts needing them should fail visibly instead of
 * quietly rendering an empty collection.
 */
export const useProtocol = (refreshKey = 0, withPositions = false) => {
  const program = useProgram();
  const { connection } = useConnection();
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [loading, setLoading] = useState(true);
  // Set only when the RPC call itself failed (rate limit, network hiccup,
  // etc.) - distinct from a clean read that confirms the protocol genuinely
  // has no config yet. The two used to collapse into the same `stats: null`
  // state, which showed "protocol not initialized" during ordinary RPC
  // flakiness. One retry covers the common case: a transient 429 that
  // clears within a couple seconds.
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retried = false;

    const load = async (): Promise<void> => {
      if (!program) return;
      setLoading(true);
      // Timed for the same reason rpcSafe times writes: a slow page is
      // only fixable once you know which phase is slow, and none of this
      // is measurable from outside the browser.
      const t0 = performance.now();
      try {
        const [cfgRaw, rsRaw] = await Promise.all([
          program.account.globalConfig.fetchNullable(configPda()),
          program.account.rewardState.fetchNullable(rewardStatePda()),
        ]);

        if (!cfgRaw || !rsRaw) {
          if (!cancelled) {
            setFetchError(false);
            setStats({
              config: null,
              totalWeight: 0,
              accRewardPerWeight: "0",
              totalAllocated: 0,
              totalClaimed: 0,
              vaultBalance: 0,
              positionCount: null,
              activeCount: null,
              totalAnsemwBurned: null,
              nftsBurned: null,
              ansemTokenProgram: TOKEN_PROGRAM_ID,
              ansemwTokenProgram: TOKEN_PROGRAM_ID,
              initialized: false,
            });
          }
          return;
        }

        const cfg = decodeConfig(cfgRaw);

        // Which program owns each mint decides which one every
        // token instruction must be handed. Read it rather than
        // assume it: $ANSEM on mainnet is Token-2022, and the vault
        // below cannot even be decoded without the right program.
        const [ansemMintAcct, ansemwMintAcct] = await Promise.all([
          connection.getAccountInfo(cfg.ansemMint),
          connection.getAccountInfo(cfg.ansemwMint),
        ]);
        const ansemTokenProgram = ansemMintAcct?.owner ?? TOKEN_PROGRAM_ID;
        const ansemwTokenProgram = ansemwMintAcct?.owner ?? TOKEN_PROGRAM_ID;

        // The collection scan, and the vault balance, in parallel -
        // neither depends on the other, and the scan is by far the
        // slower of the two once the collection fills up.
        const [positions, vaultBalance] = await Promise.all([
          withPositions ? program.account.position.all() : null,
          getAccount(connection, rewardVaultPda(), undefined, ansemTokenProgram)
            .then((v) => Number(v.amount))
            .catch(() => 0), // vault may not exist yet
        ]);

        let totalAnsemwBurned: number | null = null;
        let nftsBurned: number | null = null;
        let activeCount: number | null = null;
        if (positions) {
          totalAnsemwBurned = 0;
          nftsBurned = 0;
          activeCount = 0;
          for (const p of positions) {
            const raw = p.account as any;
            totalAnsemwBurned += Number(raw.cumulativeAnsemwBurned ?? 0);
            nftsBurned += Number(raw.absorbedCount ?? 0);
            if (raw.active) activeCount += 1;
          }
        }

        if (cancelled) return;
        setFetchError(false);
        setStats({
          config: cfg,
          totalWeight: (rsRaw as any).totalWeight.toNumber(),
          accRewardPerWeight: (rsRaw as any).accRewardPerWeight.toString(),
          totalAllocated: (rsRaw as any).totalAllocated.toNumber(),
          totalClaimed: (rsRaw as any).totalClaimed.toNumber(),
          vaultBalance,
          positionCount: positions ? positions.length : null,
          activeCount,
          totalAnsemwBurned,
          nftsBurned,
          ansemTokenProgram,
          ansemwTokenProgram,
          initialized: true,
        });
      } catch {
        if (cancelled) return;
        // Keep whatever was last loaded successfully instead of wiping it
        // to null - a transient RPC hiccup should not make an already-
        // confirmed protocol look uninitialized. One quiet retry covers
        // the common case (e.g. a rate-limited RPC that recovers in a
        // couple seconds); after that, surface it instead of retrying
        // forever.
        if (!retried) {
          retried = true;
          setTimeout(() => {
            if (!cancelled) load();
          }, 2000);
        } else {
          setFetchError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
        console.log(
          `[read:useProtocol] ${Math.round(performance.now() - t0)}ms` +
            `${withPositions ? " (+position scan)" : ""}`
        );
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [program, connection, refreshKey, withPositions]);

  return { stats, loading, fetchError };
};

export type OwnedNft = {
  asset: PublicKey;
  name: string;
  /** Off-chain metadata URI baked into the Core asset at mint time. */
  uri: string;
  position: Position | null;
};

/**
 * Ask the RPC's DAS index which assets a wallet holds.
 *
 * The obvious approach - getProgramAccounts on the Core program with
 * memcmp filters on owner and collection - is what this used to do, and
 * it is fine on devnet and fatal on mainnet. The filters are applied
 * while scanning, not before it, so the RPC walks every Core asset in
 * existence: a few thousand on devnet, millions on mainnet. Measured on
 * mainnet it ran 25 seconds and then died on the proxy's gateway
 * timeout, which is what made the Claim page hang.
 *
 * DAS answers the same question from an index in about 0.3s. Returns
 * null when the RPC does not serve it, so the caller can fall back.
 */
const dasOwnedAssets = async (
  endpoint: string,
  owner: PublicKey,
  collection: PublicKey
): Promise<{ id: string; name: string; uri: string }[] | null> => {
  const out: { id: string; name: string; uri: string }[] = [];
  const limit = 1000;

  for (let page = 1; ; page++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAssetsByOwner",
        params: { ownerAddress: owner.toBase58(), page, limit },
      }),
    });
    // Two very different reasons this can fail, and only one of them
    // should reach for the fallback.
    //
    // "Method not found" means the RPC has no DAS index - a plain
    // validator - and the fallback is the only way to answer at all.
    //
    // A 429 or a 5xx means the RPC is overloaded, and falling back would
    // answer overload by sending a *heavier* query. On launch day, with
    // everyone loading at once, that turns a slow page into a slower one
    // and pushes the RPC further under. Fail fast and let the page say
    // so; a visible error beats a self-inflicted stampede.
    if (!res.ok) {
      throw new Error(`DAS request failed: HTTP ${res.status}`);
    }
    const json = await res.json();
    if (json.error) {
      const code = json.error?.code;
      const msg = String(json.error?.message ?? "");
      const unsupported =
        code === -32601 || /method not found|unsupported/i.test(msg);
      if (unsupported) return null;
      throw new Error(`DAS error: ${msg || code}`);
    }

    const items: any[] = json.result?.items ?? [];
    for (const it of items) {
      const inCollection = (it.grouping ?? []).some(
        (g: any) =>
          g.group_key === "collection" &&
          g.group_value === collection.toBase58()
      );
      if (!inCollection) continue;
      out.push({
        id: it.id,
        name: it.content?.metadata?.name ?? "Ansem",
        uri: it.content?.json_uri ?? "",
      });
    }
    // A short page is the last page. Paginating matters for a wallet
    // holding more than `limit` NFTs of any kind, not just ours - the
    // collection filter runs after the index has already paged.
    if (items.length < limit) break;
  }
  return out;
};

/**
 * The NFTs this wallet holds from our collection.
 *
 * DAS first, and the Core account scan only if the RPC has no index.
 * The scan still works against a local validator, where Core holds
 * almost nothing and walking it costs nothing.
 */
export const useOwnedNfts = (collection: PublicKey | null, refreshKey = 0) => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const program = useProgram();
  const [nfts, setNfts] = useState<OwnedNft[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!publicKey || !collection || !program) {
      setNfts([]);
      // Clearing the flag matters: without it a run that starts with a
      // wallet and then re-runs without one (adapter reconnecting, route
      // change) leaves the spinner up forever, with no request in flight
      // to ever turn it off.
      setLoading(false);
      return;
    }
    setLoading(true);
    const t0 = performance.now();
    let tFind = 0;
    let via = "das";
    try {
      let found = await dasOwnedAssets(
        connection.rpcEndpoint,
        publicKey,
        collection
      );

      if (found === null) {
        via = "scan";
        // No DAS on this RPC. Scan *our* program instead of Core's:
        // ours holds one Position per piece and nothing else, so the
        // walk is bounded by the collection (3,333) rather than by
        // every Core asset in existence.
        //
        // Ownership is not in the Position, and deliberately so - a
        // stored owner would go stale the moment someone transferred,
        // and this program cannot observe transfers. So the pieces come
        // from us and the owners come from Core, read in batches.
        const positions = await program.account.position.all();
        const assetKeys = positions.map((p) => (p.account as any).asset as PublicKey);

        const owned: { id: string; name: string; uri: string }[] = [];
        for (let i = 0; i < assetKeys.length; i += 100) {
          const slice = assetKeys.slice(i, i + 100);
          const infos = await connection.getMultipleAccountsInfo(slice);
          infos.forEach((info, j) => {
            if (!info || !info.owner.equals(MPL_CORE_PROGRAM_ID)) return;
            // owner sits at [1..33]; collection at [34..66] when the
            // update authority variant at [33] says Collection.
            const d = info.data;
            if (new PublicKey(d.subarray(1, 33)).toBase58() !== publicKey.toBase58()) return;
            if (d[33] !== 2) return;
            if (new PublicKey(d.subarray(34, 66)).toBase58() !== collection.toBase58()) return;
            owned.push({
              id: slice[j].toBase58(),
              name: readAssetName(d),
              uri: readAssetUri(d),
            });
          });
        }
        found = owned;
      }

      tFind = performance.now();
      const assets = found.map((f) => new PublicKey(f.id));
      const positions = await program.account.position.fetchMultiple(
        assets.map((a) => positionPda(a))
      );

      setNfts(
        assets.map((asset, i) => ({
          asset,
          name: found![i].name,
          uri: found![i].uri,
          position: positions[i] ? decodePosition(positions[i]) : null,
        }))
      );
    } catch {
      setNfts([]);
    } finally {
      setLoading(false);
      const now = performance.now();
      console.log(
        `[read:useOwnedNfts] find(${via}) ${Math.round((tFind || now) - t0)}ms · ` +
          `positions ${Math.round(tFind ? now - tFind : 0)}ms · ` +
          `total ${Math.round(now - t0)}ms`
      );
    }
  }, [connection, publicKey, collection, program]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return { nfts, loading, reload: load };
};

/** Name is a borsh string right after the update authority. */
const readAssetName = (data: Buffer): string => {
  try {
    // 1 (key) + 32 (owner) + 1 (variant) + 32 (collection) = 66
    const len = data.readUInt32LE(66);
    return data.subarray(70, 70 + len).toString("utf8");
  } catch {
    return "Ansem";
  }
};

/**
 * URI is the borsh string immediately after the name. Same layout as
 * readAssetName: the name occupies [70, 70+nameLen), and the uri's own
 * 4-byte length prefix starts right after it.
 */
export const readAssetUri = (data: Buffer): string => {
  try {
    const nameLen = data.readUInt32LE(66);
    const uriLenOffset = 70 + nameLen;
    const uriLen = data.readUInt32LE(uriLenOffset);
    const start = uriLenOffset + 4;
    return data.subarray(start, start + uriLen).toString("utf8");
  } catch {
    return "";
  }
};

/** Balance of a wallet's token account, or 0 when it does not exist. */
export const useTokenBalance = (mint: PublicKey | null, refreshKey = 0) => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!publicKey || !mint) {
        setBalance(0);
        return;
      }
      try {
        // The owning token program decides both the ATA address and how
        // the account decodes, and it is not fixed here ($ANSEM on
        // mainnet is Token-2022), so read it off the mint rather than
        // defaulting to the classic program.
        const mintAcct = await connection.getAccountInfo(mint);
        const tokenProgram = mintAcct?.owner ?? TOKEN_PROGRAM_ID;
        const ata = getAssociatedTokenAddressSync(
          mint,
          publicKey,
          false,
          tokenProgram
        );
        const acct = await getAccount(connection, ata, undefined, tokenProgram);
        if (!cancelled) setBalance(Number(acct.amount));
      } catch {
        if (!cancelled) setBalance(0);
      }
    };

    load();

    // No live onAccountChange subscription here: it needs a WebSocket,
    // and the RPC this app talks to (a same-origin HTTP proxy on
    // devnet) can't hold one open. Every action already bumps
    // `refreshKey` on success, which re-runs this effect - that covers
    // the balance changing because of something *this tab* did. It
    // won't notice a transfer that lands from somewhere else while the
    // tab is open; reloading picks it up.
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, mint, refreshKey]);

  return balance;
};

/**
 * Every $ANSEMW lock this wallet holds, keyed by the piece each one
 * boosts. A wallet can stake several pieces at once, so this returns a
 * map from asset (base58) to its locked amount in base units.
 */
export const useStakeAccounts = (refreshKey = 0) => {
  const { publicKey } = useWallet();
  const program = useProgram();
  const [stakes, setStakes] = useState<Map<string, StakeAccount>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!publicKey || !program) {
        setStakes(new Map());
        return;
      }
      setLoading(true);
      const t0 = performance.now();
      try {
        // Filter by the `owner` field, which sits right after the 8-byte
        // account discriminator.
        const all = await program.account.stakeAccount.all([
          { memcmp: { offset: 8, bytes: publicKey.toBase58() } },
        ]);
        if (cancelled) return;
        const map = new Map<string, StakeAccount>();
        for (const a of all) {
          const s = decodeStakeAccount(a.account);
          map.set(s.asset.toBase58(), s);
        }
        setStakes(map);
      } catch {
        if (!cancelled) setStakes(new Map());
      } finally {
        if (!cancelled) setLoading(false);
        console.log(
          `[read:useStakeAccounts] ${Math.round(performance.now() - t0)}ms`
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [program, publicKey, refreshKey]);

  return { stakes, loading };
};
