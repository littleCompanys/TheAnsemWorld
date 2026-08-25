import { NavLink } from "react-router-dom";

/**
 * Pre-launch placeholder for every action page (mint/activate/claim/…)
 * while `VITE_PRE_LAUNCH=true`. Removing the env var re-enables the
 * real pages — no code change needed.
 */
export default function ComingSoon() {
  return (
    <main className="wrap" style={{ padding: "6rem 1.5rem", textAlign: "center" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div
          className="kicker mono"
          style={{ opacity: 0.7, letterSpacing: "0.25em" }}
        >
          LAUNCHING SOON
        </div>
        <h1 style={{ fontSize: "clamp(2.5rem, 6vw, 4rem)", margin: "1rem 0" }}>
          The Ansem World is <span className="accent">almost live.</span>
        </h1>
        <p style={{ fontSize: "1.15rem", opacity: 0.75, marginBottom: "2rem" }}>
          Mint, Activate, Claim, Stake and Forge open the moment the protocol
          goes live on mainnet. Follow along for the launch signal.
        </p>
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <NavLink to="/docs" className="btn btn-outline">
            Read the docs
          </NavLink>
          <NavLink to="/" className="btn btn-primary">
            Back home
          </NavLink>
        </div>
      </div>
    </main>
  );
}
