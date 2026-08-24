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

// Every mint_nft call handles exactly one piece - there is no on-chain
// batch-mint instruction - so a bigger quantity means more transactions,
// which means more sequential wallet approvals (see MINT_CHUNK_SIZE
// below). Past ~25 the approval rounds start taking long enough that a
// blockhash from an early round can expire before a later round sends,
// surfacing as "Signature has expired: block height exceeded" - a
// confirmed failure mode, not a hypothetical one. 25 keeps the whole
// flow to a handful of approvals.
const MAX_MINT_QTY = 25;
/** Stay under Solana's 1232-byte packet limit (signatures inflate the wire size). */
const TX_SIZE_LIMIT = 1000;
/**
 * Batches per wallet approval. A big mint can split into dozens of
 * batches (each capped at TX_SIZE_LIMIT); asking a wallet to sign all of
 * them in one `signAllTransactions` call is what actually produced the
 * "too long" error users hit past a handful of pieces - it's not a
 * single transaction's size, it's the size of the request handed to the
 * wallet extension itself. Chunking keeps each approval small and lets
 * a fresh blockhash back every chunk, so a slow approval on chunk 3
 * can't expire the blockhash chunk 8 was built with.
 */
const MINT_CHUNK_SIZE = 4;

// Transaction.serialize() isn't a pure size probe: it throws
// ("Transaction too large: X > 1232") the moment the wire size crosses
// Solana's hard packet limit, instead of just returning a length. With
// TX_SIZE_LIMIT sitting only ~230 bytes below that hard cap and one more
// mint_nft instruction costing ~300 bytes, a trial that's already at the
// soft limit can jump straight past the hard one on the very next piece -
// so the probe crashes before the packing loop below ever gets to compare
// against TX_SIZE_LIMIT and split. Treating a thrown probe as "over the
// limit" (Infinity) instead of letting it escape turns that crash into a
// normal split.
function approxTxSize(tx: Transaction): number {
  try {
    return tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).length;
  } catch {
    return Infinity;
  }
}

const COLLECTION_NAME = "The Ansem World";

export default function Mint() {
  const { publicKey, signAllTransactions, signTransaction } = useWallet();
  const provider = useProvider();
  const toast = useToast();
  const requireWallet = useRequireWallet();
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh((v) => v + 1);

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

      // Pack mints into as few txs as fit under the 1232-byte limit. Sizing
      // doesn't depend on the blockhash's actual value (it's always a
      // fixed-length 32 bytes), so one placeholder is enough for the whole
      // packing pass - the real blockhash for each group is fetched fresh
      // right before it's sent, below.
      const { blockhash: sizingBlockhash } =
        await connection.getLatestBlockhash("confirmed");

      const newGroup = () => ({
        // Both compute-budget instructions up front, always. Wallets
        // (Phantom included) auto-inject a priority-fee instruction into
        // any transaction that doesn't already carry one, particularly
        // when the network is congested - bytes our own size estimate
        // below never saw, which is how a batch that measured under
        // TX_SIZE_LIMIT still failed as "Transaction too large" once the
        // wallet finished with it. Supplying our own here means the
        // wallet has nothing left to add, and the bytes are the ones
        // this function is already counting.
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
        ] as TransactionInstruction[],
        assets: [] as Keypair[],
      });

      const groups: { instructions: TransactionInstruction[]; assets: Keypair[] }[] = [];
      let group = newGroup();

      for (const piece of pieces) {
        const trial = new Transaction();
        trial.feePayer = publicKey;
        trial.recentBlockhash = sizingBlockhash;
        for (const existing of group.instructions) trial.add(existing);
        trial.add(piece.ix);

        const wouldOverflow =
          approxTxSize(trial) > TX_SIZE_LIMIT && group.instructions.length > 1;

        if (wouldOverflow) {
          groups.push(group);
          group = newGroup();
        }
        group.instructions.push(piece.ix);
        group.assets.push(piece.asset);
      }
      if (group.assets.length > 0) groups.push(group);

      // One wallet approval per chunk of groups, not one approval for
      // everything - a signAllTransactions call carrying dozens of
      // transactions is what actually produced "too long" past a handful
      // of pieces. Each chunk gets its own fresh blockhash, so a slow
      // approval on an earlier chunk can't expire a later one's.
      for (let start = 0; start < groups.length; start += MINT_CHUNK_SIZE) {
        const chunk = groups.slice(start, start + MINT_CHUNK_SIZE);
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");

        const txs = chunk.map((g) => {
          const tx = new Transaction();
          tx.feePayer = publicKey;
          tx.recentBlockhash = blockhash;
          for (const ix of g.instructions) tx.add(ix);
          tx.partialSign(...g.assets);
          return tx;
        });

        const sendAndConfirmAll = async (signedTxs: Transaction[]) => {
          for (const stx of signedTxs) {
            const sig = await connection.sendRawTransaction(stx.serialize(), {
              skipPreflight: false,
              preflightCommitment: "confirmed",
            });
            // Not connection.confirmTransaction(): every strategy it offers
            // races an onSignature WebSocket subscription, which never
            // connects on this app's HTTP-only RPC proxy - so the REST
            // fallback inside that same race never runs either, and only
            // the independent blockheight clock is left ticking. That
            // reports "expired" ~60-90s later even when the mint actually
            // landed in seconds, which is exactly the false failure users
            // hit. confirmSignature() polls signature status directly.
            await confirmSignature(connection, sig, lastValidBlockHeight);
          }
        };

        if (signAllTransactions && txs.length > 1) {
          await sendAndConfirmAll(await signAllTransactions(txs));
        } else if (signTransaction) {
          const signed: Transaction[] = [];
          for (const tx of txs) signed.push(await signTransaction(tx));
          await sendAndConfirmAll(signed);
        } else {
          // Not provider.sendAndConfirm(): same WebSocket-race problem as
          // everywhere else in this file, but worse here - with no
          // blockhash passed, it falls back to confirmTransaction's
          // legacy signature-only strategy, which has no independent
          // expiry escape at all and just hangs on the broken subscription.
          for (const tx of txs) {
            const signed = await provider.wallet.signTransaction(tx);
            const sig = await connection.sendRawTransaction(signed.serialize(), {
              skipPreflight: false,
              preflightCommitment: "confirmed",
            });
            await confirmSignature(connection, sig, lastValidBlockHeight);
          }
        }
      }

      const minted = pieces.map((p) => p.address);
      const mintedNames = pieces.map((p) => p.name);
      setLastMinted(minted);
      setLastMintedNames(mintedNames);
      toast(
        count === 1
          ? `Minted! ${mintedNames[0]}`
          : `Minted ${count} pieces`
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
