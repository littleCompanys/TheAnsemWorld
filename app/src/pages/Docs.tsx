import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useProtocol } from "../lib/useAnsem";
import { fmtMultiplier, shortKey } from "../lib/program";

/**
 * Everything the protocol does, in plain language.
 *
 * Numbers come from the live config wherever the chain knows them, so
 * this page cannot drift from what the program actually enforces. The
 * fallbacks are the values the protocol launched with, used only when
 * the config has not loaded yet.
 */

const SECTIONS = [
  { id: "what", label: "What this is" },
  { id: "mint", label: "Mint" },
  { id: "activate", label: "Activate" },
  { id: "earning", label: "Earning" },
  { id: "tiers", label: "Tiers" },
  { id: "fuse", label: "Fuse" },
  { id: "reforge", label: "Reforge" },
  { id: "staking", label: "Staking $ANSEMW" },
  { id: "vault", label: "The vault" },
  { id: "selling", label: "Selling a piece" },
  { id: "money", label: "Where the money goes" },
  { id: "contracts", label: "Contracts" },
  { id: "faq", label: "FAQ" },
];

/**
 * Which chain this build talks to. Drives the explorer links and the
 * "money is fake" warnings below, so flipping the deployment to mainnet
 * is one env var rather than a hunt through the copy. Defaults to
 * devnet: a build that forgets to set it warns too much, never too
 * little.
 */
const CLUSTER = import.meta.env.VITE_CLUSTER ?? "devnet";
const IS_MAINNET = CLUSTER === "mainnet-beta" || CLUSTER === "mainnet";

const EXPLORER = (addr: string) =>
  IS_MAINNET
    ? `https://explorer.solana.com/address/${addr}`
    : `https://explorer.solana.com/address/${addr}?cluster=${CLUSTER}`;

const n = (v: number) => v.toLocaleString("en-US");

export default function Docs() {
  const { stats } = useProtocol();
  const cfg = stats?.config ?? null;
  const [active, setActive] = useState(SECTIONS[0].id);

  // Highlight whichever section is currently under the top of the screen.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) setActive(seen.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" }
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const thresholds = cfg?.tierThresholds ?? [25000, 75000, 150000, 300000, 850000];
  const weights = cfg?.tierWeights ?? [100, 140, 190, 250, 350];
  const fuseCosts = cfg?.fuseCosts ?? [50000, 100000];
  const activation = cfg?.activationCost ?? 25000;
  const mintPrice = cfg ? cfg.mintPrice / 1e9 : 0.05;
  const maxSupply = cfg?.maxSupply ?? 3333;

  return (
    <main className="page docs">
      <div className="wrap docs-layout">
        <aside className="docs-nav">
          <div className="kicker mono">CONTENTS</div>
          <nav>
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={active === s.id ? "on" : ""}
              >
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        <article className="docs-body">
          <div className="page-head">
            <div className="kicker mono">DOCS</div>
            <h1 className="section-title">How this works, plainly.</h1>
            <p className="section-desc">
              Every rule below is enforced by the program on chain, not by
              this site. The numbers are read live from the protocol config,
              so what you see here is what the code will actually do.
            </p>
          </div>

          <section id="what">
            <h2>What this is</h2>
            <p>
              The Ansem World is a collection of{" "}
              {maxSupply > 0 ? <b>{n(maxSupply)}</b> : "an unlimited number of"}{" "}
              NFTs on Solana. Activate a piece you own to start earning{" "}
              <b>$ANSEM</b> from the shared reward pool.
            </p>
            <p>
              Two things make it different from most collections. Your
              earnings are held <em>by the NFT itself</em>, not by your wallet
              — sell the piece and the balance goes with it. And pieces can be
              merged into each other, which destroys one of them permanently.
              The collection can only ever get smaller.
            </p>
            {!IS_MAINNET && (
              <div className="callout">
                This is running on <b>devnet</b>. The SOL is free and worth
                nothing — get some at{" "}
                <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">
                  faucet.solana.com
                </a>{" "}
                and set your wallet to devnet.
              </div>
            )}
          </section>

          <section id="mint">
            <h2>Mint</h2>
            <p>
              A piece costs <b>{mintPrice} SOL</b>, plus a small Solana rent
              deposit (~0.003 SOL) for the accounts your NFT needs. You can
              mint up to five at a time; the site packs them into as few
              transactions as will fit and asks your wallet to approve them
              together.
            </p>
            <p>
              Art is assigned at mint. There is no reveal to wait for and
              nothing hidden — what you get is what you see, immediately.
            </p>
            <p>
              Minting goes through the program, and the program is the only
              thing that can create a piece in this collection. The team
              cannot mint outside it or skip the price.
            </p>
          </section>

          <section id="activate">
            <h2>Activate</h2>
            <p>
              A freshly minted piece is <b>asleep</b>. Asleep pieces earn
              nothing. Waking one burns <b>{n(activation)} $ANSEMW</b>, and
              from that moment it starts taking a share of every round.
            </p>
            <p>
              Activation is charged every time a piece is woken, including
              after it changes hands. It does <em>not</em> raise your tier —
              tiers are bought separately, and they survive a sale.
            </p>
          </section>

          <section id="earning">
            <h2>Earning</h2>
            <p>
              When rewards are funded, the whole amount is split across every
              piece that is awake, in proportion to its weight:
            </p>
            <div className="formula mono">
              your share = your weight ÷ total awake weight
            </div>
            <p>
              A tier-1 piece has a weight of 100. If the total awake weight is
              10,000, that piece takes 1% of the round. Raising your tier or
              fusing raises your weight, and therefore your slice.
            </p>
            <p>
              Earnings accumulate whether or not you touch anything. There is
              no button to press to keep earning and nothing expires — the
              maths is done from a running total, so a piece left alone for a
              month is owed exactly what it would have been owed if you had
              checked every hour.
            </p>
          </section>

          <section id="tiers">
            <h2>Tiers</h2>
            <p>
              Five tiers. Each one costs $ANSEMW to reach, and the table is
              cumulative — the number shown is the total burned to arrive
              there, not the step.
            </p>
            <div className="table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Total $ANSEMW burned</th>
                    <th>Weight</th>
                    <th>Earning rate</th>
                  </tr>
                </thead>
                <tbody>
                  {weights.map((w, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td className="mono">{n(thresholds[i] ?? 0)}</td>
                      <td className="mono">{w}</td>
                      <td className="mono green">{fmtMultiplier(w)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Because the table is cumulative, climbing costs the same however
              you do it. Going 1 → 2 → 5 burns exactly what going straight
              from 1 to 5 burns. There is no penalty for upgrading early and
              no discount for waiting.
            </p>
            <p>
              A tier belongs to the NFT permanently. Selling the piece hands
              the tier to the buyer, and it is never reset.
            </p>
          </section>

          <section id="fuse">
            <h2>Fuse</h2>
            <p>
              Fusing merges one piece into another. The survivor keeps its
              identity and takes on the other's weight and vault balance. The
              absorbed piece is <b>burned permanently</b> — the NFT stops
              existing and cannot be recovered.
            </p>
            <div className="table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Parts</th>
                    <th>Cost to add</th>
                    <th>Bonus</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>2</td>
                    <td className="mono">{n(fuseCosts[0] ?? 0)} $ANSEMW</td>
                    <td className="mono green">+20%</td>
                  </tr>
                  <tr>
                    <td>3</td>
                    <td className="mono">{n(fuseCosts[1] ?? 0)} $ANSEMW</td>
                    <td className="mono green">+30%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              The bonus applies to the combined weight. Two tier-1 pieces are
              200 of weight together, and the fused result earns at 240. Three
              parts is the ceiling — a piece cannot absorb a fourth.
            </p>
            <p>
              Whatever the absorbed piece had banked moves into the survivor.
              Nothing is stranded on a token that is about to stop existing.
            </p>
            <p>
              Every fuse is written into a public feed on chain, visible on the
              Forge page. The last {16} are kept.
            </p>
          </section>

          <section id="reforge">
            <h2>Reforge</h2>
            <p>
              A part freezes at the tier it carried the moment it was fused in.
              Reforging raises that part later, priced off the same tier table
              as a normal upgrade.
            </p>
            <p>
              This is what makes fusing early safe: raising a part after the
              fuse costs exactly what raising it before would have. You are
              never punished for merging first and upgrading later.
            </p>
          </section>

          <section id="staking">
            <h2>Staking $ANSEMW</h2>
            <p>
              Lock $ANSEMW and one of your active pieces earns a bonus on
              top of everything else. Unlock any time — no fee, no cooldown.
            </p>
            <div className="table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Locked</th>
                    <th>Bonus</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="mono">100,000</td><td className="mono green">+5%</td></tr>
                  <tr><td className="mono">250,000</td><td className="mono green">+10%</td></tr>
                  <tr><td className="mono">500,000</td><td className="mono green">+15%</td></tr>
                  <tr><td className="mono">1,500,000</td><td className="mono green">+20%</td></tr>
                  <tr><td className="mono">2,500,000</td><td className="mono green">+25%</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              The cap sits under fusing&rsquo;s +30% on purpose. A fuse burns
              an NFT forever; a lock can be undone whenever you like. The
              irreversible choice should pay more.
            </p>

            <h3>The stake alone earns nothing</h3>
            <p>
              The bonus multiplies what an <em>active piece</em> earns. Lock
              $ANSEMW with nothing awake and you earn nothing — there is
              nothing for the bonus to multiply.
            </p>

            <h3>One piece at a time</h3>
            <p>
              Your stake points at a single piece, which takes the whole
              bonus. You can move it to another piece at any time without
              unlocking.
            </p>

            <h3>Timing cannot be gamed</h3>
            <p>
              Staking settles the piece first, so the bigger weight only
              applies to what accrues <em>after</em> it. You cannot stake
              just before a reward lands and collect on it. Topping up works
              the same way.
            </p>

            <h3>Where the bonus comes from</h3>
            <p>
              Nowhere new. The bonus raises the piece&rsquo;s weight in the
              same pool everyone shares, exactly like the fuse bonus does —
              so a staker&rsquo;s gain is a slight dilution for everyone
              else. No fresh money is created.
            </p>

            <h3>Selling a staked piece</h3>
            <p>
              A sale clears the bonus from the piece; the buyer does not
              inherit a boost they never paid for. Your locked $ANSEMW is
              untouched and still returns in full when you unlock.
            </p>

            <div className="callout">
              The staking contract only holds and returns your $ANSEMW. It
              cannot spend it, and unlocking never depends on anything else
              working.
            </div>
          </section>

          <section id="vault">
            <h2>The vault</h2>
            <p>
              Each piece has its own vault, and everything it earns lands
              there. The vault belongs to the token, not to you.
            </p>
            <p>
              Only the current holder can withdraw, and only into their own
              wallet — the program checks who holds the NFT at that instant.
              There is no withdrawal fee and no lockup. What the vault shows
              is what you get.
            </p>
          </section>

          <section id="selling">
            <h2>Selling a piece</h2>
            <p>
              A sale carries everything with it: the tier, the fused parts,
              and whatever is sitting in the vault. The buyer gets all of it.
            </p>
            <p>
              What a sale does <em>not</em> carry is the awake state. A
              transferred piece goes back to sleep, and the new holder burns
              $ANSEMW to wake it. Until they do, it earns nothing for anyone.
            </p>
            <p>
              Putting a sold piece to sleep is permissionless — anyone can do
              it, and it moves no funds. It just stops a piece from earning
              under an owner who no longer holds it.
            </p>
          </section>

          <section id="money">
            <h2>Where the money goes</h2>
            <p>
              Mint revenue in SOL goes to a treasury account fixed when the
              protocol was set up. The destination cannot be changed by
              anyone, including the team — it is pinned in the program.
            </p>
            <p>
              Every secondary sale pays a <b>5% royalty</b> into that same
              treasury. It is set as a plugin on the collection itself, so it
              applies to every piece and cannot be switched off later — the
              program has no instruction to change it once the collection
              authority moves.
            </p>
            <p>
              Rewards are a separate pot, denominated in $ANSEM. Funding it is
              permissionless: anyone holding $ANSEM can pay into the pool, and
              it spreads across every awake piece. Nobody can pull $ANSEM back
              out of that pool except by claiming what a piece has earned.
            </p>
            <div className="callout">
              <b>Be clear about the ceiling.</b> Mint revenue is finite: it
              happens once and then never again. Royalties are what make the
              reward pool refillable, and they only arrive when pieces
              actually change hands. Treat the earning rate as a share of
              whatever gets funded, not as a yield anyone has promised.
            </div>
          </section>

          <section id="contracts">
            <h2>Contracts</h2>
            <p>
              Everything below is on <b>{IS_MAINNET ? "mainnet" : "devnet"}</b>.
              Only trust addresses listed here.
            </p>
            <div className="table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>What</th>
                    <th>Address</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Program</td>
                    <td>
                      <a
                        className="mono"
                        href={EXPLORER("9Ku7jCnxjyJuUiyXscjKk5ueMPpWQnUTwpLKZfzErq2E")}
                        target="_blank"
                        rel="noreferrer"
                      >
                        9Ku7jCnxjyJuUiyXscjKk5ueMPpWQnUTwpLKZfzErq2E
                      </a>
                    </td>
                  </tr>
                  {cfg && (
                    <>
                      <tr>
                        <td>Collection</td>
                        <td>
                          <a
                            className="mono"
                            href={EXPLORER(cfg.coreCollection.toBase58())}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {cfg.coreCollection.toBase58()}
                          </a>
                        </td>
                      </tr>
                      <tr>
                        <td>$ANSEM</td>
                        <td>
                          <a
                            className="mono"
                            href={EXPLORER(cfg.ansemMint.toBase58())}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {cfg.ansemMint.toBase58()}
                          </a>
                        </td>
                      </tr>
                      <tr>
                        <td>$ANSEMW</td>
                        <td>
                          <a
                            className="mono"
                            href={EXPLORER(cfg.ansemwMint.toBase58())}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {cfg.ansemwMint.toBase58()}
                          </a>
                        </td>
                      </tr>
                      <tr>
                        <td>Treasury</td>
                        <td>
                          <a
                            className="mono"
                            href={EXPLORER(cfg.treasury.toBase58())}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortKey(cfg.treasury, 10)}
                          </a>
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
            {!cfg && (
              <p className="muted">
                Connect to {IS_MAINNET ? "mainnet" : "devnet"} to load the rest
                of the addresses from the protocol config.
              </p>
            )}
          </section>

          <section id="faq">
            <h2>FAQ</h2>

            <h3>Do you hold my NFT?</h3>
            <p>
              No. Pieces stay in your wallet the entire time, awake or asleep.
              There is no staking contract to deposit into and nothing to
              withdraw from.
            </p>

            <h3>What happens if I never claim?</h3>
            <p>
              Nothing is lost. Earnings pile up in the piece's vault and stay
              there until someone withdraws. There is no deadline.
            </p>

            <h3>Can I get a burned piece back?</h3>
            <p>
              No. Fusing destroys the absorbed NFT at the token level. It is
              gone from Solana entirely, not just from your wallet.
            </p>

            <h3>Do I lose my vault if I sell?</h3>
            <p>
              Yes — the vault travels with the NFT. Claim before you sell if
              you want the balance. This is deliberate: it is what makes a
              loaded piece worth more on the secondary market.
            </p>

            <h3>Can the team change the tier prices?</h3>
            <p>
              No. The tier table and the fuse costs are fixed when the
              protocol is initialized and there is no instruction to change
              them. An authority able to move them could dilute every holder,
              so that ability does not exist.
            </p>

            <h3>What can the team change?</h3>
            <p>
              The activation cost, the mint price, the supply cap (which can
              only be lowered once set), and a pause switch that blocks
              actions in an emergency. Pausing cannot take anything from you —
              claiming your vault is not something a pause can stop
              permanently, and the funds are never held by the team.
            </p>

            <h3>Is this audited?</h3>
            <p>
              No — the program has not been through a third-party security
              audit.{" "}
              {IS_MAINNET ? (
                <>
                  It is running on mainnet with real funds, so treat that
                  honestly: only commit what you are willing to lose, and read
                  the on-chain code yourself if the amount matters to you.
                </>
              ) : (
                <>
                  It is on devnet, where the money is fake. Do not treat it as
                  production software.
                </>
              )}
            </p>

            <h3>Is this affiliated with Ansem?</h3>
            <p>
              No. Not affiliated with pump.fun or Ansem.io.
            </p>
          </section>

          <div className="docs-foot">
            <NavLink to="/mint" className="btn btn-primary">
              Mint a piece
            </NavLink>
            <NavLink to="/activate" className="btn btn-outline">
              Wake one up
            </NavLink>
          </div>
        </article>
      </div>
    </main>
  );
}
