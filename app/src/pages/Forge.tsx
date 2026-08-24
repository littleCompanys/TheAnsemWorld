import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { NftImage } from "../components/NftImage";
import { useToast, readableError } from "../components/Toast";
import { getProgram, fmtMultiplier, shortKey } from "../lib/program";
import { useOwnedNfts, useProtocol, useProvider, useTokenBalance } from "../lib/useAnsem";
import { useFuseFeed } from "../lib/useFuseFeed";
import { useRequireWallet } from "../lib/useRequireWallet";
import { rpcSafe } from "../lib/rpcSafe";
import { NotInitialized, ProtocolLoading, ConnectionIssue } from "./Activate";

const FUSE_BONUS = [100, 120, 130];

/// Mirrors FUSE_FEED_LEN in the program — how many fuses the feed keeps.
const FEED_CAPACITY = 16;

export default function Forge() {
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
  const { nfts } = useOwnedNfts(cfg?.coreCollection ?? null, refresh);
  const ansemw = useTokenBalance(cfg?.ansemwMint ?? null, refresh);
  const {
    items: feedItems,
    total: feedTotal,
    loading: feedLoading,
  } = useFuseFeed(refresh);
  const [busy, setBusy] = useState<string | null>(null);

  const [survivor, setSurvivor] = useState("");
  const [absorbed, setAbsorbed] = useState("");
  const [reforgeAsset, setReforgeAsset] = useState("");
  const [partIndex, setPartIndex] = useState(0);
  const [partTarget, setPartTarget] = useState(2);

  const withPosition = useMemo(
    () => nfts.filter((n) => n.position),
    [nfts]
  );
  const fusable = useMemo(
    () => withPosition.filter((n) => (n.position!.absorbedCount ?? 0) < 2),
    [withPosition]
  );
  const fused = useMemo(
    () => withPosition.filter((n) => (n.position!.absorbedCount ?? 0) > 0),
    [withPosition]
  );

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

  const doFuse = () => {
    if (!requireWallet()) return;
    return run("fuse", async () => {
      const program = getProgram(provider!);
      return rpcSafe(
        program.methods.fuse().accounts({
          owner: publicKey!,
          survivorAsset: new PublicKey(survivor),
          absorbedAsset: new PublicKey(absorbed),
          collection: cfg!.coreCollection,
          ansemwMint: cfg!.ansemwMint,
          ownerAnsemw: getAssociatedTokenAddressSync(cfg!.ansemwMint, publicKey!, false, ansemwTokenProgram),
          tokenProgram: ansemwTokenProgram,
        }),
        provider!,
        "fuse"
      );
    });
  };

  const doReforge = () => {
    if (!requireWallet()) return;
    return run("reforge", async () => {
      const program = getProgram(provider!);
      return rpcSafe(
        program.methods.reforge(partIndex, partTarget).accounts({
          owner: publicKey!,
          asset: new PublicKey(reforgeAsset),
          ansemwMint: cfg!.ansemwMint,
          ownerAnsemw: getAssociatedTokenAddressSync(cfg!.ansemwMint, publicKey!, false, ansemwTokenProgram),
          tokenProgram: ansemwTokenProgram,
        }),
        provider!,
        "reforge"
      );
    });
  };

  if (protocolLoading && !stats) return <ProtocolLoading />;
  if (fetchError && !cfg) return <ConnectionIssue />;
  if (!cfg) return <NotInitialized />;

  const survivorPos = withPosition.find((n) => n.asset.toBase58() === survivor)?.position;
  const absorbedPos = withPosition.find((n) => n.asset.toBase58() === absorbed)?.position;
  const fuseCost =
    survivorPos && cfg.fuseCosts[survivorPos.absorbedCount] !== undefined
      ? cfg.fuseCosts[survivorPos.absorbedCount]
      : null;

  // Weights add, then the bonus for the resulting number of parts.
  const projected =
    survivorPos && absorbedPos
      ? Math.floor(
          ((survivorPos.baseWeight + absorbedPos.baseWeight) *
            FUSE_BONUS[survivorPos.absorbedCount + 1]) /
            100
        )
      : null;

  const reforgePos = withPosition.find(
    (n) => n.asset.toBase58() === reforgeAsset
  )?.position;
  const currentPartTier = reforgePos?.absorbedTiers?.[partIndex] ?? 0;
  const reforgeCost =
    reforgePos && partTarget > currentPartTier
      ? cfg.tierThresholds[partTarget - 1] -
        cfg.tierThresholds[currentPartTier - 1]
      : 0;

  return (
    <main className="page">
      <div className="wrap">
        <div className="page-head">
          <div className="kicker mono">FORGE</div>
          <h1 className="section-title">Fuse and reforge.</h1>
          <p className="section-desc">
            Two operations that both burn $ANSEMW. Fusing merges pieces and
            destroys one for good; reforging raises a part that is already
            inside a fused piece.
          </p>
        </div>

        <div className="notice">
          {publicKey ? (
            <>
              Your balance:{" "}
              <b className="mono">{ansemw.toLocaleString("en-US")} $ANSEMW</b>
            </>
          ) : (
            <>
              <b>Connect a wallet to fuse and reforge your pieces.</b> Browsing
              works without one — connecting is only needed once you act on
              something.
            </>
          )}
        </div>

        {/* ---------- FUSE ---------- */}
        <div className="panel">
          <h3>Fuse</h3>
          <p className="sub">
            The survivor keeps its identity and takes on the absorbed piece's
            weight and vault. The absorbed NFT is <b>burned permanently</b> —
            this cannot be undone. Two parts earn +20%, three earn +30%.
          </p>

          <div className="form-row">
            <div className="field">
              <label>SURVIVOR — keeps its identity</label>
              <select value={survivor} onChange={(e) => setSurvivor(e.target.value)}>
                <option value="">Select a piece…</option>
                {fusable.map((n) => (
                  <option key={n.asset.toBase58()} value={n.asset.toBase58()}>
                    {n.name} · {shortKey(n.asset)} · {fmtMultiplier(n.position!.effectiveWeight)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>ABSORBED — will be destroyed</label>
              <select value={absorbed} onChange={(e) => setAbsorbed(e.target.value)}>
                <option value="">Select a piece…</option>
                {withPosition
                  .filter((n) => n.asset.toBase58() !== survivor)
                  .map((n) => (
                    <option key={n.asset.toBase58()} value={n.asset.toBase58()}>
                      {n.name} · {shortKey(n.asset)} · {fmtMultiplier(n.position!.effectiveWeight)}
                    </option>
                  ))}
              </select>
            </div>

            <button
              className="btn btn-danger"
              disabled={!survivor || !absorbed || busy === "fuse"}
              onClick={doFuse}
            >
              {busy === "fuse" ? <span className="spinner" /> : null}
              Fuse — burns the absorbed piece
            </button>
          </div>

          {survivorPos && absorbedPos && (
            <div className="cost-hint">
              costs <b>{fuseCost?.toLocaleString("en-US")}</b> $ANSEMW · resulting
              rate <b>{fmtMultiplier(projected!)}</b> · absorbed vault of{" "}
              <b>{absorbedPos.vaultBalance > 0 ? "moves across" : "empty"}</b>
            </div>
          )}
        </div>

        {/* ---------- REFORGE ---------- */}
        <div className="panel">
          <h3>Reforge</h3>
          <p className="sub">
            A part freezes at the tier it carried when it was fused in.
            Reforging raises it, priced off the same table as a normal upgrade —
            so fusing early never costs you more than fusing late.
          </p>

          {fused.length === 0 ? (
            <div className="empty">
              <b>No fused pieces yet.</b>
              Reforge only applies to parts already absorbed into a piece.
            </div>
          ) : (
            <>
              <div className="form-row">
                <div className="field">
                  <label>FUSED PIECE</label>
                  <select
                    value={reforgeAsset}
                    onChange={(e) => {
                      setReforgeAsset(e.target.value);
                      setPartIndex(0);
                    }}
                  >
                    <option value="">Select a piece…</option>
                    {fused.map((n) => (
                      <option key={n.asset.toBase58()} value={n.asset.toBase58()}>
                        {n.name} · {shortKey(n.asset)}
                      </option>
                    ))}
                  </select>
                </div>

                {reforgePos && (
                  <>
                    <div className="field">
                      <label>PART</label>
                      <select
                        value={partIndex}
                        onChange={(e) => setPartIndex(Number(e.target.value))}
                        style={{ minWidth: 150 }}
                      >
                        {Array.from({ length: reforgePos.absorbedCount }).map(
                          (_, i) => (
                            <option key={i} value={i}>
                              Part {i + 1} · tier {reforgePos.absorbedTiers[i]}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div className="field">
                      <label>RAISE TO</label>
                      <select
                        value={partTarget}
                        onChange={(e) => setPartTarget(Number(e.target.value))}
                        style={{ minWidth: 150 }}
                      >
                        {cfg.tierWeights
                          .map((w, i) => ({ tier: i + 1, w }))
                          .filter((t) => t.tier > currentPartTier)
                          .map((t) => (
                            <option key={t.tier} value={t.tier}>
                              Tier {t.tier} · {fmtMultiplier(t.w)}
                            </option>
                          ))}
                      </select>
                    </div>
                  </>
                )}

                <button
                  className="btn btn-outline"
                  disabled={!reforgeAsset || busy === "reforge"}
                  onClick={doReforge}
                >
                  {busy === "reforge" ? <span className="spinner" /> : null}
                  Reforge
                </button>
              </div>

              {reforgeCost > 0 && (
                <div className="cost-hint">
                  costs <b>{reforgeCost.toLocaleString("en-US")}</b> $ANSEMW
                </div>
              )}
            </>
          )}
        </div>

        {fusable.length > 0 && (
          <>
            <div className="kicker mono" style={{ marginTop: 40 }}>
              YOUR PIECES
            </div>
            <div className="nft-grid" style={{ marginTop: 12 }}>
              {withPosition.map((n) => (
                <div className="nft-card" key={n.asset.toBase58()}>
                  <div className="art">
                    <NftImage asset={n.asset} uri={n.uri} glow={n.position!.active} />
                  </div>
                  <div className="body">
                    <div className="nft-head">
                      <div>
                        <div className="nft-name">{n.name}</div>
                        <div className="nft-id mono">{shortKey(n.asset, 6)}</div>
                      </div>
                      <span className="pill on">
                        {fmtMultiplier(n.position!.effectiveWeight)}
                      </span>
                    </div>
                    <div className="kv">
                      <div className="kv-row">
                        <span className="k">PARTS</span>
                        <span className="v">{n.position!.absorbedCount + 1} / 3</span>
                      </div>
                      <div className="kv-row">
                        <span className="k">OWN TIER</span>
                        <span className="v">{n.position!.tier}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="kicker mono" style={{ marginTop: 44 }}>
          THE FUSE FEED
        </div>
        <p className="section-desc" style={{ marginBottom: 14 }}>
          Every fuse burns an NFT for good. The last {feedLoading ? "" : ""}
          {FEED_CAPACITY} are recorded on chain for anyone to read
          {feedTotal > 0 && (
            <>
              {" "}— <b className="mono">{feedTotal.toLocaleString("en-US")}</b>{" "}
              {feedTotal === 1 ? "fuse" : "fuses"} so far
            </>
          )}
          .
        </p>

        {feedLoading ? (
          <div className="empty">Reading the feed…</div>
        ) : feedItems.length === 0 ? (
          <div className="empty">
            <b>No fuses yet.</b>
            The first one to merge two pieces shows up here.
          </div>
        ) : (
          <div className="kv" style={{ gap: 0 }}>
            {feedItems.map((f) => (
              <div className="feed-row" key={`${f.slot}-${f.absorbed.toBase58()}`}>
                <div className="feed-art">
                  <NftImage asset={f.survivor} />
                </div>
                <div className="feed-text">
                  <div className="feed-line">
                    <span className="mono">{shortKey(f.survivor, 4)}</span>{" "}
                    absorbed{" "}
                    <span className="mono burned">{shortKey(f.absorbed, 4)}</span>
                  </div>
                  <div className="feed-meta mono">
                    {f.parts} parts · {f.ansemwBurned.toLocaleString("en-US")}{" "}
                    $ANSEMW burned · slot {f.slot.toLocaleString("en-US")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
