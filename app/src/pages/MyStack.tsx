import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { NftImage } from "../components/NftImage";
import { useToast, readableError } from "../components/Toast";
import {
  getProgram,
  fmtToken,
  fmtMultiplier,
  shortKey,
  displayVaultBalance,
  createAtaIfMissing,
  type Position,
} from "../lib/program";
import { useOwnedNfts, useProtocol, useProvider, useStakeAccounts, useTokenBalance } from "../lib/useAnsem";
import { useRequireWallet } from "../lib/useRequireWallet";
import { rpcSafe } from "../lib/rpcSafe";
import { confirmSignature } from "../lib/confirmSignature";
import { Link } from "react-router-dom";
import { NotInitialized, ProtocolLoading, ConnectionIssue } from "./Activate";

export default function MyStack() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
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
  const ansemTokenProgram = stats?.ansemTokenProgram ?? TOKEN_PROGRAM_ID;
  const { nfts, loading } = useOwnedNfts(cfg?.coreCollection ?? null, refresh);
  const ansemBalance = useTokenBalance(cfg?.ansemMint ?? null, refresh);
  const { stakes } = useStakeAccounts(refresh);
  const totalLocked = Array.from(stakes.values()).reduce(
    (sum, s) => sum + s.amount,
    0
  );
  const [busy, setBusy] = useState<string | null>(null);

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

  const claim = (asset: PublicKey) => {
    if (!requireWallet()) return;
    return run(`claim-${asset.toBase58()}`, async () => {
      const program = getProgram(provider!);
      const ata = getAssociatedTokenAddressSync(cfg!.ansemMint, publicKey!, false, ansemTokenProgram);

      // The destination must exist before the program can pay into it.
      const pre: Transaction[] = [];
      const mkAta = await createAtaIfMissing(
        connection, ata, publicKey!, cfg!.ansemMint, ansemTokenProgram
      );
      if (mkAta) pre.push(new Transaction().add(mkAta));
      if (pre.length > 0) {
        const { blockhash, lastValidBlockHeight } =
          await provider!.connection.getLatestBlockhash();
        for (const tx of pre) {
          tx.recentBlockhash = blockhash;
          tx.feePayer = publicKey!;
          // Not provider.sendAndConfirm(): it confirms the same way
          // Anchor's .rpc() does under the hood, racing a WebSocket
          // subscription that never connects on this app's HTTP-only RPC
          // proxy - see confirmSignature's own comment for the full story.
          const signed = await provider!.wallet.signTransaction(tx);
          const sig = await provider!.connection.sendRawTransaction(
            signed.serialize()
          );
          await confirmSignature(provider!.connection, sig, lastValidBlockHeight);
        }
      }

      return rpcSafe(
        program.methods.claim().accounts({
          owner: publicKey!,
          asset,
          ownerAnsem: ata,
          tokenProgram: ansemTokenProgram,
        }),
        provider!,
        "claim"
      );
    });
  };

  // Same claim call as the single-piece button, looped sequentially per
  // eligible piece. The ATA-creation preflight only needs to run once for
  // the whole batch, not once per piece.
  const claimAll = async () => {
    if (!requireWallet()) return;
    const accNow = stats?.accRewardPerWeight ?? "0";
    const eligible = nfts.filter(({ position }) => {
      if (!position) return false;
      const staleActivation =
        !!publicKey && position.active && !position.activationOwner.equals(publicKey);
      if (staleActivation) return false;
      return displayVaultBalance(position, accNow) > 0;
    });
    if (eligible.length === 0) return;

    setBusy("claim-all");
    try {
      const program = getProgram(provider!);
      const ata = getAssociatedTokenAddressSync(cfg!.ansemMint, publicKey!, false, ansemTokenProgram);

      const mkAta = await createAtaIfMissing(
        connection, ata, publicKey!, cfg!.ansemMint, ansemTokenProgram
      );
      if (mkAta) {
        const tx = new Transaction().add(mkAta);
        const { blockhash, lastValidBlockHeight } =
          await provider!.connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey!;
        const signed = await provider!.wallet.signTransaction(tx);
        const sig = await provider!.connection.sendRawTransaction(signed.serialize());
        await confirmSignature(provider!.connection, sig, lastValidBlockHeight);
      }

      let ok = 0;
      let fail = 0;
      for (const { asset } of eligible) {
        try {
          await rpcSafe(
            program.methods.claim().accounts({ owner: publicKey!, asset, ownerAnsem: ata, tokenProgram: ansemTokenProgram }),
            provider!,
            "claim"
          );
          ok++;
        } catch {
          fail++;
        }
      }
      toast(
        `Claimed ${ok}/${eligible.length}${fail ? ` — ${fail} failed` : ""}`,
        fail > 0 && ok === 0
      );
    } catch (e) {
      toast(readableError(e), true);
    } finally {
      setBusy(null);
      bump();
    }
  };

  const syncOwner = (asset: PublicKey) => {
    if (!requireWallet()) return;
    return run(`sync-${asset.toBase58()}`, async () => {
      const program = getProgram(provider!);
      return rpcSafe(
        program.methods.syncOwner().accounts({ asset }),
        provider!,
        "syncOwner"
      );
    });
  };

  if (protocolLoading && !stats) return <ProtocolLoading />;
  if (fetchError && !cfg) return <ConnectionIssue />;
  if (!cfg) return <NotInitialized />;

  const acc = stats?.accRewardPerWeight ?? "0";
  const withPositions = nfts.filter((n) => n.position);
  const claimableCount = nfts.filter(({ position }) => {
    if (!position) return false;
    const staleActivation =
      !!publicKey && position.active && !position.activationOwner.equals(publicKey);
    if (staleActivation) return false;
    return displayVaultBalance(position, acc) > 0;
  }).length;
  // Same formula as each card — settled vault + pending for active pieces.
  const banked = withPositions.reduce(
    (sum, n) => sum + displayVaultBalance(n.position, acc),
    0
  );
  const earned = withPositions.reduce((sum, n) => {
    const settled = n.position?.lifetimeEarned ?? 0;
    const vault = n.position?.vaultBalance ?? 0;
    const claimable = displayVaultBalance(n.position, acc);
    // Pending not yet written into lifetime_earned on-chain.
    return sum + settled + Math.max(0, claimable - vault);
  }, 0);
  const myWeight = withPositions
    .filter((n) => n.position?.active)
    .reduce((sum, n) => sum + (n.position?.effectiveWeight ?? 0), 0);

  const share =
    stats && stats.totalWeight > 0 ? (myWeight / stats.totalWeight) * 100 : 0;

  return (
    <main className="page">
      <div className="wrap">
        <div className="page-head">
          <div className="kicker mono">VAULT</div>
          <h1 className="section-title">Your NFTs. Your rewards. One place.</h1>
          <p className="section-desc">
            View every piece you own, check its accumulated $ANSEM, and claim
            whenever you're ready.
          </p>
        </div>

        <div className="notice" style={{ marginBottom: 20 }}>
          Wallet balance:{" "}
          <b className="mono">{fmtToken(ansemBalance)} $ANSEM</b>
          {" · "}
          already claimed into your wallet
          {totalLocked > 0 && (
            <>
              {" · "}
              Staked:{" "}
              <b className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {fmtToken(totalLocked)}
                <img
                  src="/ansemw-icon.png"
                  alt="$ANSEMW"
                  style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }}
                />
                $ANSEMW
              </b>
              {" across "}
              {stakes.size} {stakes.size === 1 ? "piece" : "pieces"}
              {" · "}
              <Link to="/stake">manage</Link>
            </>
          )}
          {publicKey && claimableCount > 0 && (
            <button
              className="btn btn-primary btn-sm"
              style={{ marginLeft: 16 }}
              disabled={busy === "claim-all" || cfg.paused}
              onClick={claimAll}
            >
              {busy === "claim-all" ? <span className="spinner" /> : null}
              Claim All ({claimableCount})
            </button>
          )}
        </div>

        <div className="stats-grid" style={{ marginBottom: 28 }}>
          <div className="stat-card">
            <div>
              <div className="label mono">IN YOUR VAULTS</div>
              <div className="val" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {fmtToken(banked)}
                <img
                  src="/ansem-icon.png"
                  alt="$ANSEM"
                  style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }}
                />
              </div>
            </div>
            <div className="desc">$ANSEM banked inside your pieces, claimable now.</div>
          </div>
          <div className="stat-card">
            <div>
              <div className="label mono">LIFETIME EARNED</div>
              <div className="val">{fmtToken(earned)}</div>
            </div>
            <div className="desc">
              Everything these pieces ever earned, including under previous
              owners.
            </div>
          </div>
          <div className="stat-card">
            <div>
              <div className="label mono">YOUR ACTIVE WEIGHT</div>
              <div className="val">{myWeight}</div>
            </div>
            <div className="desc">Sum of every active piece you hold.</div>
          </div>
          <div className="stat-card">
            <div>
              <div className="label mono">SHARE OF EACH ROUND</div>
              <div className="val">
                {share.toFixed(2)}
                <span className="sub">%</span>
              </div>
            </div>
            <div className="bar">
              <span style={{ width: `${Math.min(share, 100)}%` }} />
            </div>
          </div>
        </div>

        {!publicKey && (
          <div className="empty">
            <b>Connect a wallet to see your stack.</b>
            Browsing works without one — connecting is only needed once you
            act on something.
          </div>
        )}

        {publicKey && loading && <div className="empty">Loading your stack…</div>}

        {publicKey && !loading && nfts.length === 0 && (
          <div className="empty">
            <b>Nothing here yet.</b>
            No pieces from this collection in your wallet.
          </div>
        )}

        <div className="nft-grid">
          {nfts.map(({ asset, name, uri, position }) => (
            <StackCard
              key={asset.toBase58()}
              asset={asset}
              name={name}
              uri={uri}
              position={position}
              owner={publicKey}
              accRewardPerWeight={acc}
              stakeFocus={(stakes.get(asset.toBase58())?.amount ?? 0) > 0}
              busy={busy}
              onClaim={() => claim(asset)}
              onSync={() => syncOwner(asset)}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function StackCard({
  asset,
  name,
  uri,
  position,
  owner,
  accRewardPerWeight,
  stakeFocus,
  busy,
  onClaim,
  onSync,
}: {
  asset: PublicKey;
  name: string;
  uri: string;
  position: Position | null;
  owner: PublicKey | null;
  accRewardPerWeight: string;
  stakeFocus: boolean;
  busy: string | null;
  onClaim: () => void;
  onSync: () => void;
}) {
  const id = asset.toBase58();

  // A piece still marked active under a previous owner needs someone
  // to put it back to sleep before it can be woken again. Meaningless
  // without a connected wallet - there's no "you" to compare against -
  // but this card only ever renders for NFTs owned by a connected
  // wallet in the first place.
  const staleActivation =
    !!owner && position?.active && !position.activationOwner.equals(owner);

  const displayVault = displayVaultBalance(position, accRewardPerWeight);

  return (
    <div className="nft-card">
      <div className="art" style={{ position: "relative" }}>
        <NftImage asset={asset} uri={uri} glow={!!position?.active && !staleActivation} />

        {/* Fused badge */}
        {position && position.absorbedCount > 0 && (
          <span className="fused-badge">fused ×{position.absorbedCount + 1}</span>
        )}
        {stakeFocus && position && position.stakeBonusPct > 0 && (
          <span className="fused-badge" style={{ top: position.absorbedCount > 0 ? 36 : undefined }}>
            stake +{position.stakeBonusPct}%
          </span>
        )}
      </div>

      <div className="body">
        <div className="nft-head">
          <div>
            <div className="nft-name">{name}</div>
            <div className="nft-id mono">{shortKey(asset, 6)}</div>
          </div>
          {!position ? (
            <span className="pill off">NO POSITION</span>
          ) : staleActivation ? (
            <span className="pill gold">NEEDS SYNC</span>
          ) : position.active ? (
            <span className="pill on">ACTIVE</span>
          ) : (
            <span className="pill off">ASLEEP</span>
          )}
        </div>

        {!position ? (
          <div className="cost-hint">
            No position yet — create one on the Activate page.
          </div>
        ) : (
          <>
            <div className="vault-line">
              <span className="k mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>
                HOLDING
              </span>
              <span className={`amt${displayVault === 0 ? " zero" : ""}`}>
                {displayVault === 0
                  ? "empty vault"
                  : `${fmtToken(displayVault)} $ANSEM`}
              </span>
            </div>

            {/* Multiplier — below vault, styled like the ACTIVE pill */}
            <div className="card-rate-bar">
              <span className="card-rate-val">{fmtMultiplier(position.effectiveWeight)}</span>
              {position.stakeBonusPct > 0 && (
                <span className="mono" style={{ fontSize: 11, color: "var(--green)", marginLeft: 8 }}>
                  includes +{position.stakeBonusPct}% stake
                </span>
              )}
            </div>

            <div className="card-actions">
              {staleActivation ? (
                <button
                  className="btn btn-outline btn-sm"
                  disabled={busy === `sync-${id}`}
                  onClick={onSync}
                >
                  {busy === `sync-${id}` ? <span className="spinner" /> : null}
                  Put back to sleep
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy === `claim-${id}` || displayVault === 0}
                  onClick={onClaim}
                >
                  {busy === `claim-${id}` ? <span className="spinner" /> : null}
                  {displayVault > 0 ? `Claim ${fmtToken(displayVault)} $ANSEM` : "Claim"}
                </button>
              )}
            </div>

            {staleActivation && (
              <div className="cost-hint">
                This piece is still activated under its previous owner. Putting
                it to sleep frees it to be activated by you.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
