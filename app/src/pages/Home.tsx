import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Carousel } from "../components/Carousel";
import { useProtocol } from "../lib/useAnsem";
import { fmtToken, fmtMultiplier, shortKey, toUi, PROGRAM_ID } from "../lib/program";
import { usePrices, usdValue } from "../lib/usePrices";
import { useToast } from "../components/Toast";
import { PRE_LAUNCH } from "../App";

/** Keeper cadence shown in the hero (seconds). Override with VITE_ROUND_SECONDS. */
const ROUND_SECONDS = Number(import.meta.env.VITE_ROUND_SECONDS ?? 3600);
const LAST_FUND_KEY = "ansem:lastFundAllocated";
const LAST_FUND_AT_KEY = "ansem:lastFundAt";

// This preview grid is a visual sample, not the official per-token art
// (that stays on IPFS, referenced by each NFT's on-chain metadata URI).
// Serving it from /public instead means it never depends on a public
// IPFS gateway staying responsive under a traffic spike.
const PREVIEW_PIECE_COUNT = 12;

export default function Home() {
  const { ansem: ansemPrice } = usePrices();
  // The only page that shows the collection-wide counters, so the only
  // one that pays for the scan of every Position that produces them.
  const { stats, loading } = useProtocol(0, true);
  const toast = useToast();
  const cfg = stats?.config ?? null;
  const roundLeft = useRoundCountdown(stats?.totalAllocated ?? null);

  // These four come from the position scan, which this page asks for
  // above. They read null anywhere the scan was skipped, so the reads
  // are guarded rather than defaulted - a silent zero here would draw
  // an empty collection and look like a real answer.
  const supply = stats?.positionCount ?? 0;
  const burned = stats?.nftsBurned ?? 0;
  const active = stats?.activeCount ?? 0;
  const everMinted = supply + burned;
  const burnedPct = everMinted > 0 ? (burned / everMinted) * 100 : 0;
  const activatedPct = supply > 0 ? (active / supply) * 100 : 0;
  const weightShare =
    supply > 0 && (stats?.totalWeight ?? 0) > 0
      ? Math.min(100, (active / supply) * 100)
      : 0;

  const ansemMint = cfg?.ansemMint?.toBase58() ?? null;
  const ansemwMint = cfg?.ansemwMint?.toBase58() ?? null;

  // totalClaimed is atomic units; price is per whole token.
  const paidUsd = usdValue(
    stats ? toUi(stats.totalClaimed) : null,
    ansemPrice
  );

  return (
    <>
      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">
              <span className="dot" />
              {loading
                ? "LOADING…"
                : stats?.initialized
                  ? `${supply.toLocaleString("en-US")} ON SOLANA · AND FALLING`
                  : stats
                    ? "PROTOCOL NOT INITIALIZED"
                    : "LOADING…"}
            </div>
            <h1 className="display">
              OWN A PIECE OF
              <br />
              THE <span style={{ color: "var(--green)" }}>ANSEM</span> WORLD
            </h1>
            <p className="hero-tagline">COLLECT. ACTIVATE. EARN $ANSEM.</p>
            <p className="lede">
              A community-powered NFT collection built around Ansem. Mint a{" "}
              <b>World Piece</b>, activate it with <b>$ANSEMW</b>, and
              participate in funded <b>$ANSEM</b> reward rounds.
            </p>

            <div className="hero-actions">
              {PRE_LAUNCH ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled
                    style={{ cursor: "not-allowed", opacity: 0.7 }}
                    title="Launching soon"
                  >
                    Launching soon
                  </button>
                  <Link to="/docs" className="btn btn-outline">
                    Read the docs
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/mint" className="btn btn-primary">
                    Mint a piece
                  </Link>
                  <Link to="/activate" className="btn btn-outline">
                    Activate
                  </Link>
                </>
              )}
            </div>

            {!PRE_LAUNCH && (
              <div className="hero-chips">
                <div className="stat-chip">
                  next round in{" "}
                  <b className="mono">{formatCountdown(roundLeft)}</b>
                </div>
                <div className="stat-chip">
                  supply <b className="mono">{supply.toLocaleString("en-US")}</b>
                </div>
                <div className="stat-chip">
                  $ANSEMW burned{" "}
                  <b className="mono">
                    {stats
                      ? (stats.totalAnsemwBurned ?? 0).toLocaleString("en-US")
                      : "—"}
                  </b>
                </div>
                <div className="stat-chip">
                  paid to holders{" "}
                  <b className="mono">
                    {stats ? fmtToken(stats.totalClaimed) : "—"}
                  </b>
                </div>
              </div>
            )}

            <div className="contract-row mono">
              {ansemMint ? (
                <>
                  <span className="tag">$ANSEM</span>
                  <span className="addr">{shortKey(ansemMint, 6)}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(ansemMint);
                      toast("$ANSEM mint copied.");
                    }}
                  >
                    copy
                  </button>
                </>
              ) : (
                <>
                  <span className="tag">PROGRAM</span>
                  <span className="addr">{shortKey(PROGRAM_ID, 6)}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(PROGRAM_ID.toBase58());
                      toast("Program address copied.");
                    }}
                  >
                    copy
                  </button>
                </>
              )}
              {ansemwMint && (
                <>
                  <span className="tag" style={{ marginLeft: 12 }}>
                    $ANSEMW
                  </span>
                  <span className="addr">{shortKey(ansemwMint, 6)}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(ansemwMint);
                      toast("$ANSEMW mint copied.");
                    }}
                  >
                    copy
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="hero-visual">
            <div className="frame">
              <Carousel imgClassName="hero-art" alt="The Ansem World" />
            </div>
          </div>
        </div>
      </header>

      <main>
        <section className="section-pad">
          <div className="wrap">
            <div className="kicker mono">FOUR STEPS</div>
            <h2 className="section-title">Then it runs itself.</h2>
            <p className="section-desc">
              Set it up once. Your piece earns while you sleep.
            </p>

            <div className="steps" style={{ marginTop: 24 }}>
              <div className="step-card">
                <div className="step-num">01</div>
                <div className="step-name">Mint</div>
                <p>
                  {cfg?.maxSupply
                    ? `All ${cfg.maxSupply.toLocaleString("en-US")} are mintable.`
                    : "Every World Piece is mintable."}{" "}
                  Pick one up on mint or the secondary market.
                </p>
              </div>
              <div className="step-card">
                <div className="step-num">02</div>
                <div className="step-name">Activate</div>
                <p>
                  Burn{" "}
                  {cfg
                    ? cfg.activationCost.toLocaleString("en-US")
                    : "25,000"}{" "}
                  $ANSEMW. It joins the earning pool.
                </p>
              </div>
              <div className="step-card">
                <div className="step-num">03</div>
                <div className="step-name">Fill up</div>
                <p>
                  Each funded round, it banks $ANSEM into its own vault —
                  the vault belongs to the piece, not the wallet.
                </p>
              </div>
              <div className="step-card">
                <div className="step-num">04</div>
                <div className="step-name">Climb</div>
                <p>
                  Burn $ANSEMW to raise its tier. Fuse it into another piece
                  to combine weights and shrink the supply.
                </p>
              </div>
            </div>

            <div className="mini-stats">
              <div className="mini-stat">
                <div className="mini-val">80%</div>
                <div className="mini-label">
                  of every trade funds the treasury, converted to $ANSEM
                </div>
              </div>
              <div className="mini-stat">
                <div className="mini-val">0</div>
                <div className="mini-label">fee to claim your $ANSEM, ever</div>
              </div>
              <div className="mini-stat">
                <div className="mini-val">
                  {ROUND_SECONDS > 0 ? formatInterval(ROUND_SECONDS) : "—"}
                </div>
                <div className="mini-label">
                  keeper cadence funding each reward round
                </div>
              </div>
              <div className="mini-stat">
                <div className="mini-val">0</div>
                <div className="mini-label">
                  backend — every number here reads straight from the chain
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section-pad">
          <div className="wrap">
            {!loading && stats && !stats.initialized && (
              <div className="notice warn">
                <b>The protocol has not been initialized on this cluster.</b>{" "}
                Run <span className="mono">initialize_protocol</span> against the
                validator you are connected to, then reload.
              </div>
            )}

            <div className="paid-block">
              <div className="kicker mono">PAID TO HOLDERS, ALL TIME</div>
              <div className="big-num mono" style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <img
                  src="/ansem-icon.png"
                  alt="$ANSEM"
                  style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }}
                />
                {stats ? fmtToken(stats.totalClaimed) : "—"}
                {/* Absent until the price lands - an unpriced total would
                    read as $0.00, which looks like a real answer. */}
                {paidUsd && <span className="big-num-usd">{paidUsd}</span>}
              </div>
              <div className="note">
                $ANSEM claimed out of pieces into wallets. Another{" "}
                <b className="mono" style={{ color: "var(--green)" }}>
                  {stats ? fmtToken(stats.totalAllocated - stats.totalClaimed) : "—"}
                </b>{" "}
                has been allocated on-chain and is still sitting in NFT vaults or
                pending settle.
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <div>
                  <div className="label mono">SUPPLY</div>
                  <div className="val">{supply.toLocaleString("en-US")}</div>
                </div>
                <div className="desc">
                  World Pieces still alive with a position. Fusing destroys pieces,
                  so this only ever falls.
                </div>
              </div>

              <div className="stat-card">
                <div>
                  <div className="label mono">NFTS BURNED</div>
                  <div className="val">
                    {burned.toLocaleString("en-US")}{" "}
                    <span className="sub">{burnedPct.toFixed(2)}%</span>
                  </div>
                </div>
                <div className="desc">
                  Destroyed by fusion, for good. Each fuse absorbs one piece into
                  another permanently.
                </div>
                <div className="bar">
                  <span style={{ width: `${Math.min(burnedPct, 100)}%` }} />
                </div>
              </div>

              <div className="stat-card">
                <div>
                  <div className="label mono">$ANSEMW BURNED</div>
                  <div className="val">
                    {stats
                      ? (stats.totalAnsemwBurned ?? 0).toLocaleString("en-US")
                      : "—"}
                  </div>
                </div>
                <div className="desc">
                  Gone forever — burned by every activation, tier climb, fuse and
                  reforge.
                </div>
              </div>

              <div className="stat-card">
                <div>
                  <div className="label mono">ACTIVATED</div>
                  <div className="val">
                    {stats?.activeCount ?? "—"}{" "}
                    <span className="sub">{activatedPct.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="desc">
                  Pieces currently in the earning pool. Only active weight shares
                  each funded round.
                </div>
                <div className="bar">
                  <span style={{ width: `${Math.min(activatedPct, 100)}%` }} />
                </div>
              </div>
            </div>

            <div className="stats-grid" style={{ marginTop: 1 }}>
              <div className="stat-card">
                <div>
                  <div className="label mono">TOTAL ALLOCATED</div>
                  <div className="val">
                    {stats ? fmtToken(stats.totalAllocated) : "—"}
                  </div>
                </div>
                <div className="desc">
                  All $ANSEM ever pushed into the accumulator via fund_rewards.
                </div>
              </div>

              <div className="stat-card">
                <div>
                  <div className="label mono">REWARD VAULT</div>
                  <div className="val">
                    {stats ? fmtToken(stats.vaultBalance) : "—"}
                  </div>
                </div>
                <div className="desc">
                  $ANSEM still held by the program, waiting to be claimed.
                </div>
              </div>

              <div className="stat-card">
                <div>
                  <div className="label mono">TOTAL ACTIVE WEIGHT</div>
                  <div className="val">{stats?.totalWeight ?? "—"}</div>
                </div>
                <div className="desc">
                  Every round is split across this. Your share is your weight ÷
                  this number.
                </div>
                <div className="bar">
                  <span style={{ width: `${weightShare}%` }} />
                </div>
              </div>

              <div className="stat-card">
                <div>
                  <div className="label mono">MAX SUPPLY</div>
                  <div className="val">
                    {cfg?.maxSupply
                      ? cfg.maxSupply.toLocaleString("en-US")
                      : "∞"}
                  </div>
                </div>
                <div className="desc">
                  Minted so far:{" "}
                  <span className="mono">
                    {cfg ? cfg.currentSupply.toLocaleString("en-US") : "—"}
                  </span>
                  . Cap is fixed in GlobalConfig (0 = unlimited).
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section-pad">
          <div className="wrap">
            <div className="kicker mono">ACTIVATION TIERS</div>
            <h2 className="section-title">Five upgrades. Burn to climb.</h2>
            <p className="section-desc">
              Tiers are bought by burning $ANSEMW, and the cost is cumulative —
              you only ever pay the difference. The tier belongs to the NFT and
              survives a sale.
            </p>

            <div className="tiers" style={{ marginTop: 24 }}>
              {(cfg?.tierWeights ?? [100, 140, 190, 250, 350]).map((w, i) => {
                const thresholds = cfg?.tierThresholds ?? [
                  25_000, 75_000, 150_000, 300_000, 850_000,
                ];
                return (
                  <div className="tier-card" data-tier={i + 1} key={i}>
                    <div className="tier-name">
                      <span className="swatch" />
                      Tier {i + 1}
                    </div>
                    <div className="tier-mult mono">
                      {fmtMultiplier(w)} earning rate
                    </div>
                    <p>
                      {i === 0
                        ? "Where every piece starts once activated."
                        : `Upgrade from tier ${i} by burning the difference.`}
                    </p>
                    <div className="burn">
                      {thresholds[i].toLocaleString("en-US")} $ANSEMW total
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="section-pad">
          <div className="wrap">
            <div className="kicker mono">FORGE</div>
            <h2 className="section-title">Merge pieces. Shrink the supply.</h2>
            <p className="section-desc">
              Fusing folds one piece into another: their weights add, a bonus
              applies on top, and the absorbed piece is burned for good. Whatever
              it had banked moves to the survivor.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
              <div className="stat-chip">
                two pieces <b className="mono">+20%</b>
              </div>
              <div className="stat-chip">
                three pieces <b className="mono">+30%</b>
              </div>
              <div className="stat-chip">
                three top-tier <b className="mono">13.65x</b>
              </div>
              <Link to="/forge" className="btn btn-outline">
                Open the Forge →
              </Link>
            </div>
          </div>
        </section>

        <section className="section-pad">
          <div className="wrap">
            <div className="kicker mono">THE COLLECTION</div>
            <h2 className="section-title">World pieces.</h2>
            <p className="section-desc">
              A sample of the art. Every piece is unique — 3,333 in total.
            </p>
            <div className="collection-grid">
              {Array.from({ length: PREVIEW_PIECE_COUNT }, (_, i) => i + 1).map((n) => (
                <div className="piece-card" key={n}>
                  <div className="art">
                    <img
                      src={`/collection-preview/${n}.png`}
                      alt="World Piece"
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </div>
                  <div className="meta">
                    <div className="name">The Ansem World</div>
                    <div className="id mono">preview</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

/** Countdown to the next keeper-style funding window. */
function useRoundCountdown(totalAllocated: number | null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // When a new fund lands (totalAllocated rises), reset the window.
  useEffect(() => {
    if (totalAllocated == null) return;
    const prev = Number(localStorage.getItem(LAST_FUND_KEY) ?? "NaN");
    if (!Number.isFinite(prev) || totalAllocated > prev) {
      localStorage.setItem(LAST_FUND_KEY, String(totalAllocated));
      localStorage.setItem(LAST_FUND_AT_KEY, String(Date.now()));
    }
  }, [totalAllocated]);

  return useMemo(() => {
    if (!ROUND_SECONDS || ROUND_SECONDS <= 0) return 0;
    const raw = localStorage.getItem(LAST_FUND_AT_KEY);
    const lastAt = raw ? Number(raw) : Date.now();
    const elapsed = Math.floor((now - lastAt) / 1000);
    const left = ROUND_SECONDS - (elapsed % ROUND_SECONDS);
    return left <= 0 ? ROUND_SECONDS : left;
  }, [now]);
}

function formatCountdown(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatInterval(sec: number) {
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}
