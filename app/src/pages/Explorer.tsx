import { useEffect, useState } from "react";
import { NftImage } from "../components/NftImage";
import {
  fetchAllPositions,
  fmtToken,
  fmtMultiplier,
  shortKey,
  displayVaultBalance,
  type Position,
} from "../lib/program";
import { useProgram, useProtocol } from "../lib/useAnsem";

type Row = { pubkey: any; data: Position };

export default function Explorer() {
  const program = useProgram();
  // No position scan here: this page already fetches every position
  // itself, so asking useProtocol for the same data would download the
  // whole collection twice on every visit.
  const { stats } = useProtocol();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyActive, setOnlyActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!program) return;
      setLoading(true);
      try {
        const all = await fetchAllPositions(program);
        // Deliberately unsorted here. Ranking needs the reward
        // accumulator, which arrives from useProtocol on its own
        // schedule - sorting at fetch time would order the list by
        // whatever had been settled, which is usually nothing.
        if (!cancelled) setRows(all);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [program]);

  const acc = stats?.accRewardPerWeight ?? "0";
  // Counted from the rows this page already has, rather than from the
  // duplicate scan it used to ask useProtocol for.
  const activeCount = rows.filter((r) => r.data.active).length;

  // What a piece is holding is its settled vault PLUS everything it has
  // earned since. `vault_balance` only moves when something settles the
  // position - a claim, an upgrade, a fuse - so for a piece that has
  // simply been earning it sits at zero, and reading it raw reported
  // "empty vault" for pieces holding thousands of $ANSEM.
  //
  // That is the one number this page exists to publish: a buyer checks a
  // piece's vault to know what it is worth, because the vault travels
  // with the NFT. Under-reporting it would have buyers underpaying and
  // sellers handing over a stack they did not know they had.
  const shown = (onlyActive ? rows.filter((r) => r.data.active) : rows)
    .map((r) => ({ ...r, holding: displayVaultBalance(r.data, acc) }))
    .sort((a, b) => b.holding - a.holding);

  return (
    <main className="page">
      <div className="wrap">
        <div className="page-head">
          <div className="kicker mono">EXPLORER</div>
          <h1 className="section-title">Every piece on chain.</h1>
          <p className="section-desc">
            What each World Piece is holding is public. Check a piece's vault
            before you buy it — a piece sitting on a stack is worth at least that
            stack to whoever owns it next.
          </p>
        </div>

        <div className="form-row">
          <button
            className={`btn btn-sm ${onlyActive ? "btn-primary" : "btn-outline"}`}
            onClick={() => setOnlyActive((v) => !v)}
          >
            {onlyActive ? "Showing active only" : "Show active only"}
          </button>
          <div className="stat-chip">
            tracked <b className="mono">{rows.length}</b>
          </div>
          <div className="stat-chip">
            active <b className="mono">{loading ? "—" : activeCount}</b>
          </div>
        </div>

        {loading && <div className="empty">Reading the chain…</div>}

        {!loading && shown.length === 0 && (
          <div className="empty">
            <b>No positions on this cluster yet.</b>
            Positions appear here as soon as a piece is registered.
          </div>
        )}

        <div className="nft-grid">
          {shown.map(({ data, holding }) => {
            const id = data.asset.toBase58();
            return (
              <div className="nft-card" key={id}>
                <div className="art">
                  <NftImage asset={data.asset} glow={data.active} />
                </div>
                <div className="body">
                  <div className="nft-head">
                    <div>
                      <div className="nft-name">The Ansem World</div>
                      <div className="nft-id mono">{shortKey(data.asset, 6)}</div>
                    </div>
                    {data.active ? (
                      <span className="pill on">
                        {fmtMultiplier(data.effectiveWeight)}
                      </span>
                    ) : (
                      <span className="pill off">ASLEEP</span>
                    )}
                  </div>

                  <div className="kv">
                    <div className="kv-row">
                      <span className="k">TIER</span>
                      <span className="v">
                        {data.tier}
                        {data.absorbedCount > 0 && (
                          <span style={{ color: "var(--gold)" }}>
                            {" "}· fused ×{data.absorbedCount + 1}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="kv-row">
                      <span className="k">LIFETIME</span>
                      <span className="v">{fmtToken(data.lifetimeEarned)}</span>
                    </div>
                  </div>

                  <div className="vault-line">
                    <span
                      className="mono"
                      style={{ color: "var(--text-faint)", fontSize: 11 }}
                    >
                      HOLDING
                    </span>
                    <span className={`amt${holding === 0 ? " zero" : ""}`}>
                      {holding === 0
                        ? "empty vault"
                        : `${fmtToken(holding)} $ANSEM`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
