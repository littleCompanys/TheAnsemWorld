import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  ComputeBudgetProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import { Carousel, CAROUSEL_IMAGES } from "../components/Carousel";
import { useToast, readableError } from "../components/Toast";
import { getProgram } from "../lib/program";
import { useProtocol, useProvider } from "../lib/useAnsem";
import { useRequireWallet } from "../lib/useRequireWallet";
import { confirmSignature } from "../lib/confirmSignature";
import { notifyChainChanged } from "../lib/refresh";

// Every mint_nft call handles exactly one piece - there is no on-chain
// batch-mint instruction - and every piece needs its own wallet
// approval, because batching the signatures is what Phantom blocks (see
// the signing section below). So quantity N means N prompts, and 25 is
// already a lot of clicking.
//
// It cannot go much higher regardless: past ~25 the approval rounds take
// long enough that a blockhash from an early round can expire before a
// later round sends, surfacing as "Signature has expired: block height
// exceeded" - a confirmed failure mode, not a hypothetical one.
const MAX_MINT_QTY = 25;

/**
 * Compute budget, measured rather than guessed.
 *
 * Simulated against mainnet: one mint consumes 35,662 units and two
 * consume 74,024, so the marginal cost of a piece is ~38k and the fixed
 * overhead is small. These leave roughly 40-60% headroom on top, which
 * covers the Core CPI growing a little without going back to asking for
 * the ceiling.
 *
 * Re-measure with `simulateTransaction` if mint_nft ever does more work;
 * a limit set too low fails the whole transaction, not just the excess.
 */
const CU_BASE = 15_000;
const CU_PER_MINT = 45_000;

const COLLECTION_NAME = "The Ansem World";

export default function Mint() {
  const { publicKey, signTransaction } = useWallet();
  const provider = useProvider();
  const toast = useToast();
  const requireWallet = useRequireWallet();
  const [refresh, setRefresh] = useState(0);
  // Refresh this page, and tell the rest of the app - the header's
  // token balances live outside every page and have no other way to
  // learn that a burn just happened.
  const bump = () => {
    setRefresh((v) => v + 1);
    notifyChainChanged();
  };

  const { stats, loading } = useProtocol(refresh);
  const cfg = stats?.config ?? null;

  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState(1);
  const [lastMinted, setLastMinted] = useState<string[]>([]);

  const [lastMintedNames, setLastMintedNames] = useState<string[]>([]);

  const [previewIndex, setPreviewIndex] = useState(0);
  const reroll = () =>
    setPreviewIndex((i) => (i + 1) % CAROUSEL_IMAGES.length);

  const priceInSol = cfg ? cfg.mintPrice / LAMPORTS_PER_SOL : null;
  const totalPriceInSol =
    priceInSol != null ? (priceInSol * qty).toFixed(3) : null;

  const remaining =
    cfg && cfg.maxSupply > 0
      ? Math.max(0, cfg.maxSupply - cfg.currentSupply)
      : null;

  const maxQty =
    remaining == null ? MAX_MINT_QTY : Math.min(MAX_MINT_QTY, remaining);

  useEffect(() => {
    if (maxQty >= 1 && qty > maxQty) setQty(maxQty);
  }, [maxQty, qty]);

  const supplyDisplay = useMemo(() => {
    if (!cfg) return null;
    if (cfg.maxSupply === 0)
      return `${cfg.currentSupply} minted · unlimited supply`;
    return `${cfg.currentSupply} / ${cfg.maxSupply.toLocaleString("en-US")} minted`;
  }, [cfg]);

  const pct =
    cfg && cfg.maxSupply > 0
      ? Math.min(100, (cfg.currentSupply / cfg.maxSupply) * 100)
      : null;

  const soldOut =
    cfg && cfg.maxSupply > 0 && cfg.currentSupply >= cfg.maxSupply;

  const doMint = async () => {
    if (!requireWallet()) return;
    if (!provider || !cfg || !publicKey) return;
    const count = Math.min(Math.max(1, qty), maxQty);
    if (count < 1) return;

    setBusy(true);
    try {
      const program = getProgram(provider);
      const connection = provider.connection;
      const supplyCursor = cfg.currentSupply;

      type MintPiece = {
        ix: TransactionInstruction;
        asset: Keypair;
        address: string;
        name: string;
      };
      const pieces: MintPiece[] = [];

      for (let i = 0; i < count; i++) {
        const asset = Keypair.generate();
        const n = supplyCursor + 1 + i;
        // Display only. The program derives both the name and the URI
        // from its own counter, so this is a prediction of what the
        // chain will assign, never an instruction to it - which is what
        // stops anyone from asking for a particular piece.
        const name = `${COLLECTION_NAME} #${n}`;
        const ix = await program.methods
          .mintNft()
          .accounts({
            buyer: publicKey,
            asset: asset.publicKey,
            collection: cfg.coreCollection,
            treasury: cfg.treasury,
          })
          .instruction();
        pieces.push({ ix, asset, address: asset.publicKey.toBase58(), name });
      }

      // One piece per transaction.
      //
      // These used to be packed several to a transaction, up to the byte
      // limit, which is cheaper in fees and was fine on-chain. But the
      // mint is the only action in this app that carries signers beyond
      // the user's wallet - Metaplex Core uses an asset account's own
      // address as the NFT's permanent address, so a fresh keypair has
      // to sign each piece's creation - and it is also the only action
      // Phantom blocks with "dApp may be malicious". Every other
      // instruction here signs with the wallet alone and passes.
      //
      // Packing three pieces meant handing the wallet a transaction
      // pre-signed by three keys it had never seen. One piece per
      // transaction is the fewest such signatures the mint can have: the
      // wallet, plus the one account being created.
      //
      // Approvals are still batched below, so the user does not sign
      // once per piece.
      let failedCount = 0;
      let lastValid = 0;
      const groups = pieces.map((piece) => ({
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({
            units: CU_BASE + CU_PER_MINT,
          }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
          piece.ix,
        ] as TransactionInstruction[],
        assets: [piece.asset],
        piece,
      }));

      // One piece at a time: fresh blockhash, approve, send.
      //
      // The batch approval is gone (see below), so approvals are now
      // sequential and a person clicking through twenty of them takes
      // minutes. Building a whole chunk on one blockhash and sending
      // after every approval meant the last transaction carried a
      // blockhash minutes old - past the ~60-90s a blockhash lives - and
      // it came back as "Transaction simulation failed. Logs: []", which
      // reads like a program error and is nothing of the kind. An empty
      // log array means the transaction never reached execution at all.
      //
      // Fetching per piece keeps the gap to one approval: blockhash,
      // prompt, send. Confirmations are collected and awaited together
      // at the end, so nobody waits on chain finality between prompts.
      // Paired with their piece, so the report can name exactly what
      // landed rather than assuming every piece asked for was minted.
      const sent: { sig: string; piece: MintPiece }[] = [];
      let cancelled = 0;

      for (const g of groups) {
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");

        const tx = new Transaction();
        tx.feePayer = publicKey;
        tx.recentBlockhash = blockhash;
        for (const ix of g.instructions) tx.add(ix);

        // The asset keypairs sign AFTER the wallet, never before.
        //
        // Both orders produce the same valid transaction - signature
        // slots are fixed by the message header, so when each is filled
        // changes nothing about the bytes that reach the chain. What
        // changes is what the wallet is handed. Signing the assets first
        // meant Phantom received a transaction already carrying a
        // signature from a key it had never seen, and it blocked the
        // request as "dApp may be malicious". Signing them after hands
        // the wallet a clean transaction and adds the account-creation
        // signature to what it gives back. Measured on mainnet: that
        // single change cleared the block.
        //
        // The other half of the same finding: `signAllTransactions` is
        // not used at all. One piece was accepted through
        // `signTransaction` while any quantity above one went through
        // the batch call and was blocked, with identical per-transaction
        // contents. "Sign these seven at once" is how a drainer sweeps
        // an account, and no amount of simplifying each transaction
        // changes what the batch request looks like. So seven pieces is
        // seven prompts - worse to click through than one, and far
        // better than a block that stops the mint outright.
        let signed: Transaction;
        try {
          signed = signTransaction
            ? await signTransaction(tx)
            : await provider.wallet.signTransaction(tx);
        } catch (err) {
          // Declining a prompt throws, and letting that escape the loop
          // was skipping everything after it - the confirmations, the
          // count, the list of what was minted. Pieces that had already
          // been paid for and created went unreported, which is the one
          // failure mode worse than failing outright.
          //
          // Stop prompting: someone who just clicked Cancel does not
          // want the next nine popups. Whatever already went out is
          // still confirmed and reported below.
          cancelled = count - sent.length;
          break;
        }
        signed.partialSign(...g.assets);

        try {
          const sig = await connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          });
          sent.push({ sig, piece: g.piece });
          lastValid = Math.max(lastValid, lastValidBlockHeight);
        } catch (err: any) {
          // A preflight rejection arrives as SendTransactionError with
          // the interesting part behind getLogs(); without it the
          // message is the useless "Logs: []" that sent us looking in
          // the wrong place. An empty log array means the transaction
          // never reached execution - a signature or blockhash problem,
          // not a program one - so dump the shape alongside.
          let logs: string[] | null = null;
          try {
            logs = (await err?.getLogs?.(connection)) ?? null;
          } catch {
            /* getLogs can itself fail; the dump still helps */
          }
          console.error("[mint] preflight rejected", {
            message: String(err?.message ?? err),
            logs,
            signatures: signed.signatures.map((x) => ({
              key: x.publicKey.toBase58(),
              signed: x.signature !== null,
            })),
            feePayer: signed.feePayer?.toBase58(),
            blockhash: signed.recentBlockhash,
          });
          failedCount += 1;
        }
      }

      // Confirm what went out, together. Anything that fails to confirm
      // was still charged for and may yet land, so it is reported as
      // unconfirmed rather than as a failure.
      const settled = await Promise.allSettled(
        sent.map((x) => confirmSignature(connection, x.sig, lastValid))
      );
      const landed = sent.filter((_, i) => settled[i].status === "fulfilled");
      const unconfirmed = sent.length - landed.length;

      // Show exactly the pieces that exist, not the pieces that were
      // asked for. Someone who cancelled halfway still owns what they
      // approved, and the wallet balance will tell them so whether the
      // page does or not.
      setLastMinted(landed.map((x) => x.piece.address));
      setLastMintedNames(landed.map((x) => x.piece.name));

      if (landed.length === 0) {
        throw new Error(
          cancelled > 0
            ? "Cancelled — no pieces were minted."
            : "No pieces were minted. Check the console for the reason."
        );
      }

      const parts: string[] = [];
      if (cancelled > 0) parts.push(`${cancelled} cancelled`);
      if (failedCount > 0) parts.push(`${failedCount} failed`);
      if (unconfirmed > 0) parts.push(`${unconfirmed} still confirming`);

      toast(
        parts.length > 0
          ? `Minted ${landed.length} of ${count} — ${parts.join(", ")}`
          : count === 1
            ? `Minted! ${landed[0].piece.name}`
            : `Minted ${landed.length} pieces`,
        failedCount > 0
      );
      reroll();
      bump();
    } catch (e) {
      toast(readableError(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <div className="wrap">
        <div className="page-head">
          <div className="kicker mono">MINT</div>
          <h1 className="section-title">Own a part of the Ansem World.</h1>
          <p className="section-desc">
            Minting doesn't just give you an NFT.
            <br />
            It puts you inside an ecosystem designed to grow alongside $ANSEM.
          </p>
        </div>

        {!loading && stats && !stats.initialized && (
          <div className="notice warn">
            <b>Protocol not initialized on this cluster.</b> Run{" "}
            <span className="mono">initialize_protocol</span> first.
          </div>
        )}

        {cfg && !cfg.collectionClaimed && (
          <div className="notice warn" style={{ marginBottom: 20 }}>
            <b>Minting is not open yet.</b> The collection authority has not
            been transferred to the program. Run{" "}
            <span className="mono">claim_collection_authority</span> to enable
            minting.
          </div>
        )}

        {cfg?.paused && (
          <div className="notice warn" style={{ marginBottom: 20 }}>
            <b style={{ color: "var(--gold)" }}>
              The protocol is paused — minting is temporarily disabled.
            </b>
          </div>
        )}

        <div className="mint-layout">
          <div className="mint-preview-wrap">
            <div className="mint-preview">
              <div className="art art-lg">
                <Carousel
                  index={previewIndex}
                  onIndexChange={setPreviewIndex}
                  alt="Ansem World preview"
                />
              </div>
              <div className="mint-preview-meta">
                <div className="nft-name" style={{ fontSize: 18 }}>
                  {/* Every piece's traits were randomized at generation
                   * time - no naming or numbering a specific piece here,
                   * since minting doesn't reveal which one you'll get. */}
                  {qty === 1 ? COLLECTION_NAME : `${COLLECTION_NAME} × ${qty}`}
                </div>
                {lastMintedNames.length > 0 && (
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--green)",
                      marginTop: 4,
                    }}
                  >
                    Last: {lastMintedNames.join(" · ")}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mint-info">
            {cfg && (
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="kv" style={{ marginBottom: 12 }}>
                  <div className="kv-row">
                    <span className="k">PRICE</span>
                    <span className="v green">
                      {priceInSol?.toFixed(3)} SOL
                      {qty > 1 && (
                        <span
                          style={{ color: "var(--text-dim)", fontWeight: 500 }}
                        >
                          {" "}
                          × {qty}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="kv-row">
                    <span className="k">TOTAL</span>
                    <span className="v green">{totalPriceInSol} SOL</span>
                  </div>
                  {/* Each piece is signed on its own - batching the
                      signatures is what wallets block - so the prompt
                      count is worth saying before someone starts
                      clicking, not after. */}
                  {qty > 1 && (
                    <div className="kv-row">
                      <span className="k">APPROVALS</span>
                      <span className="v mono" style={{ fontSize: 12 }}>
                        {qty} — one per piece
                      </span>
                    </div>
                  )}
                  <div className="kv-row">
                    <span className="k">SUPPLY</span>
                    <span className="v mono" style={{ fontSize: 12 }}>
                      {supplyDisplay}
                    </span>
                  </div>
                  {cfg.maxSupply > 0 && (
                    <div className="kv-row">
                      <span className="k">REMAINING</span>
                      <span className="v">
                        {(cfg.maxSupply - cfg.currentSupply).toLocaleString(
                          "en-US"
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {pct !== null && (
                  <div className="supply-bar">
                    <div
                      className="supply-fill"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="supply-pct mono">{pct.toFixed(1)}%</div>
                  </div>
                )}
              </div>
            )}

            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="qty-compact">
                <div>
                  <h3 style={{ marginBottom: 4 }}>Quantity</h3>
                  <p className="sub" style={{ margin: 0 }}>
                    Up to {MAX_MINT_QTY}
                    {remaining != null ? ` · ${remaining} left` : ""}
                  </p>
                </div>
                <div className="qty-slider-val mono">{qty}</div>
              </div>
              <input
                type="range"
                className="qty-slider"
                min={1}
                max={Math.max(maxQty, 1)}
                step={1}
                value={qty}
                disabled={busy || maxQty < 1}
                onChange={(e) => setQty(Number(e.target.value))}
                aria-label="Mint quantity"
              />
            </div>

            <button
              className="btn btn-primary"
              style={{ width: "100%", fontSize: 16, padding: "14px 0" }}
              disabled={
                busy ||
                !cfg ||
                !cfg.collectionClaimed ||
                !!cfg.paused ||
                !!soldOut ||
                maxQty < 1
              }
              onClick={doMint}
            >
              {busy ? (
                <>
                  <span className="spinner" /> Minting…
                </>
              ) : soldOut ? (
                "Sold out"
              ) : !cfg?.collectionClaimed ? (
                "Minting not open"
              ) : qty === 1 ? (
                <>Mint for {totalPriceInSol} SOL</>
              ) : (
                <>
                  Mint {qty} for {totalPriceInSol} SOL
                </>
              )}
            </button>

            {cfg && !soldOut && !cfg.paused && cfg.collectionClaimed && (
              <div
                className="cost-hint"
                style={{ marginTop: 10, textAlign: "center" }}
              >
                + Solana account rent per piece (~0.003 SOL)
              </div>
            )}
          </div>
        </div>

        {lastMinted.length > 0 && (
          <div className="notice" style={{ marginTop: 32 }}>
            <b style={{ color: "var(--green)" }}>
              {lastMinted.length === 1
                ? "Piece minted successfully."
                : `${lastMinted.length} pieces minted successfully.`}
            </b>{" "}
            {lastMintedNames.join(" · ")}. Head to{" "}
            <a href="/activate" style={{ color: "var(--green)" }}>
              Activate
            </a>{" "}
            to wake them up and start earning $ANSEM.
          </div>
        )}
      </div>
    </main>
  );
}
