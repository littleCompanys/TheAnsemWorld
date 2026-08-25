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

const LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/mint", label: "Mint" },
  { to: "/activate", label: "Activate" },
  { to: "/claim", label: "Claim" },
  { to: "/stake", label: "Stake" },
  { to: "/forge", label: "Forge" },
  { to: "/explorer", label: "Explorer" },
  { to: "/docs", label: "Docs" },
];

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
        <Route path="/mint" element={<Mint />} />
        <Route path="/activate" element={<Activate />} />
        <Route path="/claim" element={<MyStack />} />
        <Route path="/stake" element={<Stake />} />
        <Route path="/forge" element={<Forge />} />
        <Route path="/explorer" element={<Explorer />} />
        <Route path="/docs" element={<Docs />} />
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
            <NavLink to="/mint">Mint</NavLink>
            <NavLink to="/activate">Activate</NavLink>
            <NavLink to="/claim">Claim</NavLink>
            <NavLink to="/stake">Stake</NavLink>
            <NavLink to="/forge">Forge</NavLink>
            <NavLink to="/explorer">Explorer</NavLink>
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
