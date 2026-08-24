import { useEffect, useState } from "react";
import { NftImage } from "../components/NftImage";
import {
  fetchAllPositions,
  fmtToken,
  fmtMultiplier,
  shortKey,
  type Position,
} from "../lib/program";
import { useProgram, useProtocol } from "../lib/useAnsem";

type Row = { pubkey: any; data: Position };

export default function Explorer() {
  const program = useProgram();
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
        if (!cancelled) {
          // Biggest earners first - that is what anyone browsing the
          // collection actually wants to see.
          all.sort((a, b) => b.data.vaultBalance - a.data.vaultBalance);
          setRows(all);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [program]);

  const shown = onlyActive ? rows.filter((r) => r.data.active) : rows;

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
            active <b className="mono">{stats?.activeCount ?? "—"}</b>
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
          {shown.map(({ data }) => {
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
                    <span className={`amt${data.vaultBalance === 0 ? " zero" : ""}`}>
                      {data.vaultBalance === 0
                        ? "empty vault"
                        : `${fmtToken(data.vaultBalance)} $ANSEM`}
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
