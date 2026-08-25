import { useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useProtocol, useTokenBalance } from "./lib/useAnsem";
import { fmtToken } from "./lib/program";
import { usePrices, fmtUsd } from "./lib/usePrices";
import { useChainRefresh } from "./lib/refresh";
import Home from "./pages/Home";
import Activate from "./pages/Activate";
import MyStack from "./pages/MyStack";
import Forge from "./pages/Forge";
import Explorer from "./pages/Explorer";
import Mint from "./pages/Mint";
import Stake from "./pages/Stake";
import Docs from "./pages/Docs";
import ComingSoon from "./pages/ComingSoon";

/**
 * Toggle for the pre-launch state. While `VITE_PRE_LAUNCH=true` in the
 * frontend env, every action page (mint/activate/claim/stake/forge/
 * explorer) renders the `ComingSoon` placeholder instead of the real UI,
 * their links vanish from the nav, and the header hides wallet balances
 * that only make sense once the protocol is live. Flip the env to any
 * other value (or delete it) and redeploy to unlock the app in one shot.
 */
export const PRE_LAUNCH = import.meta.env.VITE_PRE_LAUNCH === "true";

const ALL_LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/mint", label: "Mint" },
  { to: "/activate", label: "Activate" },
  { to: "/claim", label: "Claim" },
  { to: "/stake", label: "Stake" },
  { to: "/forge", label: "Forge" },
  { to: "/explorer", label: "Explorer" },
  { to: "/docs", label: "Docs" },
];

const LINKS = PRE_LAUNCH
  ? ALL_LINKS.filter((l) => l.to === "/" || l.to === "/docs")
  : ALL_LINKS;

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { connected } = useWallet();
  // The header outlives every page, so it needs the app-wide signal
  // rather than any page's own counter - otherwise burning $ANSEMW on
  // the Activate page updates that page and leaves this number stale.
  const chainRefresh = useChainRefresh();
  const { stats } = useProtocol(chainRefresh);
  const ansemBalance = useTokenBalance(
    stats?.config?.ansemMint ?? null,
    chainRefresh
  );
  const ansemwBalance = useTokenBalance(
    stats?.config?.ansemwMint ?? null,
    chainRefresh
  );

  return (
    <>
      <div className="grid-bg" />

      <nav>
        <div className="nav-inner">
          <NavLink to="/" className="logo">
            <span>THE <span className="accent">ANSEM</span> WORLD</span>
          </NavLink>

          <div className={`nav-links${menuOpen ? " open" : ""}`}>
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                {l.label}
              </NavLink>
            ))}
          </div>

          <div className="nav-right">
            {connected && stats?.config && (
              <>
                <div className="wallet-balance mono" title="Claimed $ANSEM in this wallet">
                  <img
                    src="/ansem-icon.png"
                    alt="$ANSEM"
                    style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }}
                  />
                  <b>{fmtToken(ansemBalance)}</b>
                </div>
                <div className="wallet-balance mono" title="$ANSEMW in this wallet">
                  <img
                    src="/ansemw-icon.png"
                    alt="$ANSEMW"
                    style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }}
                  />
                  <b>{fmtToken(ansemwBalance)}</b>
                </div>
              </>
            )}
            <WalletMultiButton />
            <button
              className="menu-toggle"
              aria-label="Menu"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/docs" element={<Docs />} />
        {PRE_LAUNCH ? (
          // Any bookmarked action URL lands on the placeholder rather than
          // rendering half-broken pages against a config that doesn't exist.
          <>
            <Route path="/mint" element={<ComingSoon />} />
            <Route path="/activate" element={<ComingSoon />} />
            <Route path="/claim" element={<ComingSoon />} />
            <Route path="/stake" element={<ComingSoon />} />
            <Route path="/forge" element={<ComingSoon />} />
            <Route path="/explorer" element={<ComingSoon />} />
          </>
        ) : (
          <>
            <Route path="/mint" element={<Mint />} />
            <Route path="/activate" element={<Activate />} />
            <Route path="/claim" element={<MyStack />} />
            <Route path="/stake" element={<Stake />} />
            <Route path="/forge" element={<Forge />} />
            <Route path="/explorer" element={<Explorer />} />
          </>
        )}
      </Routes>

      <Footer />
      <PriceBar />
    </>
  );
}

function Footer() {
  return (
    <footer>
      <div className="wrap footer-grid">
        <div>
          <div className="logo">
            <span>THE <span className="accent">ANSEM</span> WORLD</span>
          </div>
          <p className="foot-desc">
            Earning $ANSEM every hour on Solana. Only ever shrinking.
          </p>
        </div>
        <div className="foot-links">
          <div className="foot-col">
            {!PRE_LAUNCH && <NavLink to="/mint">Mint</NavLink>}
            {!PRE_LAUNCH && <NavLink to="/activate">Activate</NavLink>}
            {!PRE_LAUNCH && <NavLink to="/claim">Claim</NavLink>}
            {!PRE_LAUNCH && <NavLink to="/stake">Stake</NavLink>}
            {!PRE_LAUNCH && <NavLink to="/forge">Forge</NavLink>}
            {!PRE_LAUNCH && <NavLink to="/explorer">Explorer</NavLink>}
            <NavLink to="/docs">Docs</NavLink>
          </div>
          <div className="foot-col">
            <a href="#">Magic Eden</a>
            <a href="https://x.com/TheAnsemWorld_" target="_blank" rel="noreferrer">X</a>
          </div>
        </div>
      </div>
      <div className="wrap foot-bottom">
        Only trust contract addresses listed on this site. We will never message
        you first, and we will never ask you to sign anything on another site or
        app.
      </div>
    </footer>
  );
}

/** Solana mark from a static PNG in /public. */
function SolanaMark() {
  return <img src="/solana.png" alt="Solana" width={16} height={16} />;
}

/** Static (non-scrolling) price bar: SOL and $ANSEM, live from Jupiter. */
function PriceBar() {
  const { sol, ansem } = usePrices();

  return (
    <div className="price-bar">
      <div className="price-pill">
        <SolanaMark />
        <b>{fmtUsd(sol)}</b>
      </div>
      <div className="price-pill">
        <img src="/ansem-icon.png" alt="$ANSEM" />
        <b>{fmtUsd(ansem)}</b>
      </div>
    </div>
  );
}
