import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { NftImage } from "../components/NftImage";
import { useToast, readableError } from "../components/Toast";
import { getProgram, fmtMultiplier, fmtToken, shortKey, type Position } from "../lib/program";
import { useOwnedNfts, useProtocol, useProvider, useTokenBalance } from "../lib/useAnsem";
import { useRequireWallet } from "../lib/useRequireWallet";
import { rpcSafe } from "../lib/rpcSafe";

export default function Activate() {
  const { publicKey } = useWallet();
  const provider = useProvider();
  const toast = useToast();
  const requireWallet = useRequireWallet();
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh((v) => v + 1);

  const { stats, loading: protocolLoading, fetchError } = useProtocol(refresh);
  const cfg = stats?.config ?? null;
  // Which token program owns each mint - read from chain by useProtocol,
  // because $ANSEM on mainnet is Token-2022 and every instruction that
  // moves a token has to be handed the matching program.
  const ansemwTokenProgram = stats?.ansemwTokenProgram ?? TOKEN_PROGRAM_ID;
  const { nfts, loading } = useOwnedNfts(cfg?.coreCollection ?? null, refresh);
  const ansemwBalance = useTokenBalance(cfg?.ansemwMint ?? null, refresh);

  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      const sig = await fn();
      toast(`Done — ${shortKey(sig, 6)}`);
      bump();
    } catch (e) {
      toast(readableError(e), true);
    } finally {
      setBusy(null);
    }
  };

  const initPosition = (asset: PublicKey) => {
    if (!requireWallet()) return;
    return run(`init-${asset.toBase58()}`, async () => {
      const program = getProgram(provider!);
      return rpcSafe(
        program.methods.initializePosition().accounts({ payer: publicKey!, asset }),
        provider!,
        "initializePosition"
      );
    });
  };

  const activate = (asset: PublicKey) => {
    if (!requireWallet()) return;
    return run(`act-${asset.toBase58()}`, async () => {
      const program = getProgram(provider!);
      return rpcSafe(
        program.methods.activate().accounts({
          owner: publicKey!,
          asset,
          ansemwMint: cfg!.ansemwMint,
          ownerAnsemw: getAssociatedTokenAddressSync(cfg!.ansemwMint, publicKey!, false, ansemwTokenProgram),
          tokenProgram: ansemwTokenProgram,
        }),
        provider!,
        "activate"
      );
    });
  };

  // Sequential, not batched into one transaction: activate signs per-asset
  // accounts (ansemwMint burn, position PDA) same as the single-piece
  // button above, just looped. Each call gets its own busy key so a
  // failure on one piece doesn't stop the rest - the run() wrapper isn't
  // reused here because it only tracks one busy key at a time and this
  // needs to report a batch summary instead of a single toast.
  const activateAll = async () => {
    if (!requireWallet()) return;
    const eligible = nfts.filter(({ position }) => position && !position.active);
    if (eligible.length === 0) return;
    setBusy("activate-all");
    const program = getProgram(provider!);
    let ok = 0;
    let fail = 0;
    for (const { asset } of eligible) {
      try {
        await rpcSafe(
          program.methods.activate().accounts({
            owner: publicKey!,
            asset,
            ansemwMint: cfg!.ansemwMint,
            ownerAnsemw: getAssociatedTokenAddressSync(cfg!.ansemwMint, publicKey!, false, ansemwTokenProgram),
            tokenProgram: ansemwTokenProgram,
          }),
          provider!,
          "activate"
        );
        ok++;
      } catch {
        fail++;
      }
    }
    setBusy(null);
    bump();
    toast(
      `Activated ${ok}/${eligible.length}${fail ? ` — ${fail} failed` : ""}`,
      fail > 0 && ok === 0
    );
  };

  const upgrade = (asset: PublicKey, target: number) => {
    if (!requireWallet()) return;
    return run(`up-${asset.toBase58()}`, async () => {
      const program = getProgram(provider!);
      return rpcSafe(
        program.methods.upgradeTier(target).accounts({
          owner: publicKey!,
          asset,
          ansemwMint: cfg!.ansemwMint,
          ownerAnsemw: getAssociatedTokenAddressSync(cfg!.ansemwMint, publicKey!, false, ansemwTokenProgram),
          tokenProgram: ansemwTokenProgram,
        }),
        provider!,
        "upgradeTier"
      );
    });
  };

  if (protocolLoading && !stats) return <ProtocolLoading />;
  if (fetchError && !cfg) return <ConnectionIssue />;
  if (!cfg) return <NotInitialized />;

  const asleepCount = nfts.filter(({ position }) => position && !position.active).length;

  return (
    <main className="page">
      <div className="wrap">
        <div className="page-head">
          <div className="kicker mono">ACTIVATE</div>
          <h1 className="section-title">Wake your pieces.</h1>
          <p className="section-desc">
            Activation burns {cfg.activationCost.toLocaleString("en-US")} $ANSEMW
            and puts the piece into the earning pool. Selling it puts it back to
            sleep — the tier and the vault stay with the NFT, but the new owner
            burns again to wake it.
          </p>
        </div>

        <div className="notice">
          Your balance:{" "}
          <b className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {fmtToken(ansemwBalance, 2)}
            <img
              src="/ansemw-icon.png"
              alt="$ANSEMW"
              style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }}
            />
            $ANSEMW
          </b>
          {cfg.paused && (
            <>
              {" · "}
              <b style={{ color: "var(--gold)" }}>
                The protocol is paused — actions will be rejected.
              </b>
            </>
          )}
          {publicKey && asleepCount > 0 && (
            <button
              className="btn btn-primary btn-sm"
              style={{ marginLeft: 16 }}
              disabled={busy === "activate-all" || cfg.paused}
              onClick={activateAll}
            >
              {busy === "activate-all" ? <span className="spinner" /> : null}
              Activate All ({asleepCount})
            </button>
          )}
        </div>

        {loading && <div className="empty">Loading your pieces…</div>}

        {!publicKey && (
          <div className="empty">
            <b>Connect a wallet to see and activate your pieces.</b>
            Browsing works without one — connecting is only needed once you
            act on something.
          </div>
        )}

        {publicKey && !loading && nfts.length === 0 && (
          <div className="empty">
            <b>No World Pieces in this wallet.</b>
            They must belong to the collection this protocol was configured
            with: <span className="mono">{shortKey(cfg.coreCollection, 6)}</span>
          </div>
        )}

        <div className="nft-grid">
          {nfts.map(({ asset, name, uri, position }) => (
            <PieceCard
              key={asset.toBase58()}
              asset={asset}
              name={name}
              uri={uri}
              position={position}
              tierWeights={cfg.tierWeights}
              tierThresholds={cfg.tierThresholds}
              busy={busy}
              onInit={() => initPosition(asset)}
              onActivate={() => activate(asset)}
              onUpgrade={(t) => upgrade(asset, t)}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function PieceCard({
  asset,
  name,
  uri,
  position,
  tierWeights,
  tierThresholds,
  busy,
  onInit,
  onActivate,
  onUpgrade,
}: {
  asset: PublicKey;
  name: string;
  uri: string;
  position: Position | null;
  tierWeights: number[];
  tierThresholds: number[];
  busy: string | null;
  onInit: () => void;
  onActivate: () => void;
  onUpgrade: (target: number) => void;
}) {
  const id = asset.toBase58();
  const [target, setTarget] = useState<number>((position?.tier ?? 1) + 1);

  // Reset target to the next tier whenever the position's tier changes
  // (e.g. after an upgrade). Without this, target stays at the old
  // selected value and target > position.tier becomes false, hiding the cost.
  useEffect(() => {
    setTarget((position?.tier ?? 1) + 1);
  }, [position?.tier]);

  const upgradeCost =
    position && target > position.tier
      ? tierThresholds[target - 1] - tierThresholds[position.tier - 1]
      : 0;

  const canUpgrade = position && position.tier < tierWeights.length;

  return (
    <div className="nft-card">
      <div className="art">
        <NftImage asset={asset} uri={uri} glow={!!position?.active} />
      </div>
      <div className="body">
        <div className="nft-head">
          <div>
            <div className="nft-name">{name}</div>
            <div className="nft-id mono">{shortKey(asset, 6)}</div>
          </div>
          {!position ? (
            <span className="pill off">NO POSITION</span>
          ) : position.active ? (
            <span className="pill on">ACTIVE</span>
          ) : (
            <span className="pill off">ASLEEP</span>
          )}
        </div>

        {position && (
          <div className="kv">
            <div className="kv-row">
              <span className="k">TIER</span>
              <span className="v">
                {position.tier}
                {position.absorbedCount > 0 && (
                  <span style={{ color: "var(--gold)" }}>
                    {" "}· fused ×{position.absorbedCount + 1}
                  </span>
                )}
              </span>
            </div>
            <div className="kv-row">
              <span className="k">EARNING RATE</span>
              <span className="v green">
                {fmtMultiplier(position.effectiveWeight)}
              </span>
            </div>
          </div>
        )}

        <div className="card-actions">
          {!position && (
            <button
              className="btn btn-outline btn-sm"
              disabled={busy === `init-${id}`}
              onClick={onInit}
            >
              {busy === `init-${id}` ? <span className="spinner" /> : null}
              Create position
            </button>
          )}

          {position && !position.active && (
            <button
              className="btn btn-primary btn-sm"
              style={{ flex: "1 0 100%" }}
              disabled={busy === `act-${id}`}
              onClick={onActivate}
            >
              {busy === `act-${id}` ? <span className="spinner" /> : null}
              Activate
            </button>
          )}

          {canUpgrade && (
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <select
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
                style={{ flex: 1, minWidth: 110 }}
              >
                {tierWeights
                  .map((w, i) => ({ tier: i + 1, w }))
                  .filter((t) => t.tier > position!.tier)
                  .map((t) => (
                    <option key={t.tier} value={t.tier}>
                      Tier {t.tier} · {fmtMultiplier(t.w)}
                    </option>
                  ))}
              </select>
              <button
                className="btn btn-outline btn-sm"
                disabled={busy === `up-${id}`}
                onClick={() => onUpgrade(target)}
              >
                {busy === `up-${id}` ? <span className="spinner" /> : null}
                Upgrade
              </button>
            </div>
          )}
        </div>

        {canUpgrade && (
          <div className="cost-hint">
            Costs <b>{upgradeCost.toLocaleString("en-US")}</b> $ANSEMW to upgrade
          </div>
        )}
      </div>
    </div>
  );
}

export function NotConnected() {
  return (
    <main className="page">
      <div className="wrap">
        <div className="empty">
          <b>Connect a wallet to continue.</b>
          Your pieces, their vaults and every action live on chain — nothing to
          show until we know which wallet is asking.
        </div>
      </div>
    </main>
  );
}

export function ProtocolLoading() {
  return (
    <main className="page">
      <div className="wrap">
        <div className="empty">Loading protocol…</div>
      </div>
    </main>
  );
}

export function NotInitialized() {
  return (
    <main className="page">
      <div className="wrap">
        <div className="notice warn">
          <b>The protocol is not initialized on this cluster.</b> Run{" "}
          <span className="mono">initialize_protocol</span> against the validator
          this site is pointed at, then reload.
        </div>
      </div>
    </main>
  );
}

/**
 * Shown when the read itself failed (RPC hiccup, rate limit) rather than
 * a confirmed absence of config - so it doesn't get confused with
 * NotInitialized, which means the opposite: a clean read that found
 * nothing.
 */
export function ConnectionIssue() {
  return (
    <main className="page">
      <div className="wrap">
        <div className="notice warn">
          <b>Having trouble reaching the network.</b> This is usually a
          temporary RPC hiccup, not a real problem — reload in a moment.
        </div>
      </div>
    </main>
  );
}
