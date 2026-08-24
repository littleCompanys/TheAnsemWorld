import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { NftImage } from "../components/NftImage";
import { useToast, readableError } from "../components/Toast";
import {
  getProgram,
  fmtToken,
  shortKey,
  stakeBonusFor,
  STAKE_TIERS,
  nextStakeTier,
  stakeVaultPda,
  type StakeAccount,
} from "../lib/program";
import {
  useOwnedNfts,
  useProtocol,
  useProvider,
  useStakeAccounts,
  useTokenBalance,
  type OwnedNft,
} from "../lib/useAnsem";
import { NotInitialized, ProtocolLoading, ConnectionIssue } from "./Activate";
import { useRequireWallet } from "../lib/useRequireWallet";
import { rpcSafe } from "../lib/rpcSafe";

const parseAmount = (raw: string): number | null => {
  const n = Number(raw.replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n * 1e6);
};

export default function Stake() {
  const { publicKey } = useWallet();
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
  const ansemwTokenProgram = stats?.ansemwTokenProgram ?? TOKEN_PROGRAM_ID;
  const { nfts, loading: nftsLoading } = useOwnedNfts(
    cfg?.coreCollection ?? null,
    refresh
  );
  const { stakes, loading: stakesLoading } = useStakeAccounts(refresh);
  const ansemwBalance = useTokenBalance(cfg?.ansemwMint ?? null, refresh);

  const activePieces = useMemo(
    () =>
      nfts.filter(
        (n) => n.position?.active && n.position.activationOwner.equals(publicKey!)
      ),
    [nfts, publicKey]
  );

  const totalLocked = useMemo(() => {
    let sum = 0;
    for (const s of stakes.values()) sum += s.amount;
    return sum;
  }, [stakes]);

  const stakedCount = useMemo(() => {
    let n = 0;
    for (const s of stakes.values()) if (s.amount > 0) n += 1;
    return n;
  }, [stakes]);

  const ensureStakeVault = async () => {
    const info = await provider!.connection.getAccountInfo(stakeVaultPda());
    if (info) return;
    const program = getProgram(provider!);
    await rpcSafe(
      program.methods
        .initializeStakeVault()
        .accounts({ payer: publicKey!, ansemwMint: cfg!.ansemwMint, tokenProgram: ansemwTokenProgram }),
      provider!,
      "initializeStakeVault"
    );
    toast("Stake vault created");
  };

  const doStake = async (asset: OwnedNft["asset"], amountBase: number) => {
    if (!requireWallet()) throw new Error("Connect a wallet first");
    if (amountBase > ansemwBalance) throw new Error("Not enough $ANSEMW");
    await ensureStakeVault();
    const program = getProgram(provider!);
    return rpcSafe(
      program.methods.stake(new BN(amountBase)).accounts({
        staker: publicKey!,
        stakerAnsemw: getAssociatedTokenAddressSync(cfg!.ansemwMint, publicKey!, false, ansemwTokenProgram),
        asset,
        tokenProgram: ansemwTokenProgram,
      }),
      provider!,
      "stake"
    );
  };

  const doUnstake = async (asset: OwnedNft["asset"]) => {
    if (!requireWallet()) throw new Error("Connect a wallet first");
    const program = getProgram(provider!);
    return rpcSafe(
      program.methods.unstake().accounts({
        staker: publicKey!,
        stakerAnsemw: getAssociatedTokenAddressSync(cfg!.ansemwMint, publicKey!, false, ansemwTokenProgram),
        asset,
        tokenProgram: ansemwTokenProgram,
      }),
      provider!,
      "unstake"
    );
  };

  if (protocolLoading && !stats) return <ProtocolLoading />;
  if (fetchError && !cfg) return <ConnectionIssue />;
  if (!cfg) return <NotInitialized />;

  const loading = nftsLoading || stakesLoading;

  return (
    <main className="page">
      <div className="wrap">
        <div className="page-head">
          <div className="kicker mono">STAKE</div>
          <h1 className="section-title">Lock $ANSEMW. Boost your pieces.</h1>
          <p className="section-desc">
            The stake alone earns nothing — it multiplies what an active piece
            earns. Each piece has its own lock and its own bonus tier, so you
            can boost several at once. Unlock any time, no fee, no cooldown.
          </p>
        </div>

        <div className="notice">
          Wallet balance:{" "}
          <b className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {fmtToken(ansemwBalance, 2)}
            <img
              src="/ansemw-icon.png"
              alt="$ANSEMW"
              style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }}
            />
            $ANSEMW
          </b>
          {totalLocked > 0 && (
            <>
              {" · "}
              Locked across {stakedCount}{" "}
              {stakedCount === 1 ? "piece" : "pieces"}:{" "}
              <b className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {fmtToken(totalLocked, 2)}
                <img
                  src="/ansemw-icon.png"
                  alt="$ANSEMW"
                  style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }}
                />
                $ANSEMW
              </b>
            </>
          )}
        </div>

        <div className="panel" style={{ marginBottom: 24 }}>
          <h3>Tiers</h3>
          <p className="sub">
            Applied per piece, from that piece&apos;s own lock alone.
          </p>
          <div className="table-wrap">
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Locked $ANSEMW (per piece)</th>
                  <th>Bonus</th>
                </tr>
              </thead>
              <tbody>
                {STAKE_TIERS.map((t) => (
                  <tr key={t.amount}>
                    <td className="mono">{t.amount.toLocaleString("en-US")}</td>
                    <td className="mono green">+{t.bonusPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {!publicKey && (
          <div className="empty">
            <b>Connect a wallet to lock $ANSEMW on your pieces.</b>
            Browsing works without one — connecting is only needed once you
            act on something.
          </div>
        )}

        {publicKey && loading && <div className="empty">Loading…</div>}

        {publicKey && !loading && activePieces.length === 0 && (
          <div className="empty">
            <b>No active pieces.</b> Activate at least one World Piece before
            staking — the bonus multiplies active earnings, and nothing else.
          </div>
        )}

        {!loading && activePieces.length > 0 && (
          <div className="nft-grid">
            {activePieces.map((nft) => (
              <PieceStakeCard
                key={nft.asset.toBase58()}
                nft={nft}
                stake={stakes.get(nft.asset.toBase58()) ?? null}
                walletBalance={ansemwBalance}
                onStake={doStake}
                onUnstake={doUnstake}
                onDone={bump}
                toast={toast}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function PieceStakeCard({
  nft,
  stake,
  walletBalance,
  onStake,
  onUnstake,
  onDone,
  toast,
}: {
  nft: OwnedNft;
  stake: StakeAccount | null;
  walletBalance: number;
  onStake: (asset: OwnedNft["asset"], amountBase: number) => Promise<string>;
  onUnstake: (asset: OwnedNft["asset"]) => Promise<string>;
  onDone: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const { asset, name, uri } = nft;
  const [amountUi, setAmountUi] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const locked = stake?.amount ?? 0;
  const currentBonus = stakeBonusFor(locked);
  const nextTier = nextStakeTier(locked);
  const added = parseAmount(amountUi) ?? 0;
  const previewBase = locked + added;
  const previewBonus = stakeBonusFor(previewBase);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      const sig = await fn();
      toast(`Done — ${shortKey(sig, 6)}`);
      setAmountUi("");
      onDone();
    } catch (e) {
      toast(readableError(e), true);
    } finally {
      setBusy(null);
    }
  };

  const stakeDisabled =
    !amountUi || parseAmount(amountUi) === null || busy !== null;

  return (
    <div className="nft-card">
      <div className="art">
        <NftImage asset={asset} uri={uri} glow={locked > 0} />
        {locked > 0 && currentBonus > 0 && (
          <span className="fused-badge">stake +{currentBonus}%</span>
        )}
      </div>
      <div className="body">
        <div className="nft-head">
          <div>
            <div className="nft-name">{name}</div>
            <div className="nft-id mono">{shortKey(asset, 6)}</div>
          </div>
          {locked > 0 ? (
            <span className="pill on">STAKED</span>
          ) : (
            <span className="pill off">ACTIVE</span>
          )}
        </div>

        <div className="kv">
          <div className="kv-row">
            <span className="k">LOCKED</span>
            <span className="v mono">
              {locked > 0 ? fmtToken(locked, 2) : "—"}
            </span>
          </div>
          <div className="kv-row">
            <span className="k">BONUS</span>
            <span className="v green mono">
              {currentBonus > 0 ? `+${currentBonus}%` : "—"}
            </span>
          </div>
          <div className="kv-row">
            <span className="k">NEXT TIER</span>
            <span className="v mono" style={{ color: "var(--text-faint)" }}>
              {nextTier
                ? `+${nextTier.bonusPct}% · lock ${fmtToken(
                    nextTier.needBase,
                    0
                  )} more`
                : "MAX"}
            </span>
          </div>
        </div>

        <div className="form-row" style={{ marginTop: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>{locked > 0 ? "TOP UP ($ANSEMW)" : "AMOUNT ($ANSEMW)"}</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 250000"
              value={amountUi}
              onChange={(e) => setAmountUi(e.target.value)}
            />
          </div>
        </div>

        {amountUi && parseAmount(amountUi) !== null && (
          <div className="cost-hint">
            After this: <b>{fmtToken(previewBase, 2)}</b> locked →{" "}
            <b className="green">+{previewBonus}%</b>
            {previewBonus > currentBonus && " (tier up)"}
          </div>
        )}

        <div className="card-actions">
          <button
            className="btn btn-primary btn-sm"
            disabled={stakeDisabled}
            onClick={() =>
              run("stake", () => onStake(asset, parseAmount(amountUi)!))
            }
          >
            {busy === "stake" ? <span className="spinner" /> : null}
            {locked > 0 ? "Top up" : "Lock $ANSEMW"}
          </button>

          {locked > 0 && (
            <button
              className="btn btn-outline btn-sm"
              disabled={busy !== null}
              onClick={() => run("unstake", () => onUnstake(asset))}
            >
              {busy === "unstake" ? <span className="spinner" /> : null}
              Unlock
            </button>
          )}
        </div>

        {walletBalance === 0 && locked === 0 && (
          <div className="cost-hint" style={{ color: "var(--text-faint)" }}>
            No $ANSEMW in this wallet to lock.
          </div>
        )}
      </div>
    </div>
  );
}
