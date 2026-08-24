import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Connection, TransactionInstruction } from "@solana/web3.js";
import {
  getAccount,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import idl from "../idl/ansem_world_v4.json";
import type { AnsemWorldV4 } from "../idl/ansem_world_v4";

export const PROGRAM_ID = new PublicKey(idl.address);
export const MPL_CORE_PROGRAM_ID = new PublicKey(
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
);

export type AnsemProgram = Program<AnsemWorldV4>;

export const getProgram = (provider: AnchorProvider): AnsemProgram =>
  new Program(idl as AnsemWorldV4, provider);

/** PDAs. These mirror the seeds declared in the Rust program. */
export const configPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];

export const rewardStatePda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("reward_state")], PROGRAM_ID)[0];

export const rewardVaultPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("reward_vault")], PROGRAM_ID)[0];

export const treasuryPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("treasury")], PROGRAM_ID)[0];

export const fuseFeedPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("fuse_feed")], PROGRAM_ID)[0];

export const stakeVaultPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("stake_vault")], PROGRAM_ID)[0];

export const stakeAccountPda = (owner: PublicKey, asset: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), owner.toBuffer(), asset.toBuffer()],
    PROGRAM_ID
  )[0];

/** Mirrors `STAKE_TIERS` in the on-chain program. Amounts are whole $ANSEMW. */
export const STAKE_TIERS: readonly { amount: number; bonusPct: number }[] = [
  { amount: 100_000, bonusPct: 5 },
  { amount: 250_000, bonusPct: 10 },
  { amount: 500_000, bonusPct: 15 },
  { amount: 1_500_000, bonusPct: 20 },
  { amount: 2_500_000, bonusPct: 25 },
];

/** Bonus tier for a locked amount in base units (6 decimals). */
export const stakeBonusFor = (amountBase: number): number => {
  let bonus = 0;
  for (const tier of STAKE_TIERS) {
    if (amountBase >= tier.amount * 10 ** DECIMALS) bonus = tier.bonusPct;
  }
  return bonus;
};

/** Next tier above the current locked amount, if any. */
export const nextStakeTier = (amountBase: number) => {
  for (const tier of STAKE_TIERS) {
    const need = tier.amount * 10 ** DECIMALS;
    if (amountBase < need) return { ...tier, needBase: need - amountBase };
  }
  return null;
};

export const positionPda = (asset: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("position"), asset.toBuffer()],
    PROGRAM_ID
  )[0];

/** Shape of a Position as the UI cares about it. */
export type Position = {
  asset: PublicKey;
  activationOwner: PublicKey;
  active: boolean;
  tier: number;
  baseWeight: number;
  effectiveWeight: number;
  cumulativeAnsemwBurned: number;
  absorbedCount: number;
  absorbedTiers: number[];
  vaultBalance: number;
  lifetimeEarned: number;
  rewardDebt: string; // u128 stored as decimal string to avoid overflow
  stakeBonusPct: number;
};

export type StakeAccount = {
  owner: PublicKey;
  asset: PublicKey;
  amount: number;
};

const toNum = (v: BN | number) => (typeof v === "number" ? v : v.toNumber());

export const decodePosition = (raw: any): Position => ({
  asset: raw.asset,
  activationOwner: raw.activationOwner,
  active: raw.active,
  tier: raw.tier,
  baseWeight: toNum(raw.baseWeight),
  effectiveWeight: toNum(raw.effectiveWeight),
  cumulativeAnsemwBurned: toNum(raw.cumulativeAnsemwBurned),
  absorbedCount: raw.absorbedCount,
  absorbedTiers: Array.from(raw.absorbedTiers ?? []),
  vaultBalance: toNum(raw.vaultBalance),
  lifetimeEarned: toNum(raw.lifetimeEarned),
  rewardDebt: (raw.rewardDebt ?? 0).toString(),
  stakeBonusPct: raw.stakeBonusPct ?? 0,
});

export const decodeStakeAccount = (raw: any): StakeAccount => ({
  owner: raw.owner,
  asset: raw.asset,
  amount: toNum(raw.amount),
});

export const isDefaultPubkey = (k: PublicKey) =>
  k.equals(PublicKey.default);

export type Config = {
  authority: PublicKey;
  ansemMint: PublicKey;
  ansemwMint: PublicKey;
  coreCollection: PublicKey;
  treasury: PublicKey;
  activationCost: number;
  tierThresholds: number[];
  tierWeights: number[];
  fuseCosts: number[];
  paused: boolean;
  // Mint fields (added in mint_nft instruction)
  mintPrice: number;      // lamports
  maxSupply: number;      // 0 = unlimited
  currentSupply: number;
  collectionClaimed: boolean;
};

export const decodeConfig = (raw: any): Config => ({
  authority: raw.authority,
  ansemMint: raw.ansemMint,
  ansemwMint: raw.ansemwMint,
  coreCollection: raw.coreCollection,
  treasury: raw.treasury,
  activationCost: toNum(raw.activationCost),
  tierThresholds: raw.tierThresholds.map(toNum),
  tierWeights: raw.tierWeights.map(toNum),
  fuseCosts: raw.fuseCosts.map(toNum),
  paused: raw.paused,
  mintPrice: toNum(raw.mintPrice ?? 0),
  maxSupply: toNum(raw.maxSupply ?? 0),
  currentSupply: toNum(raw.currentSupply ?? 0),
  collectionClaimed: raw.collectionClaimed ?? false,
});

/**
 * Every Position the program knows about.
 *
 * Fine at this scale: the collection is a few thousand NFTs, and one
 * getProgramAccounts call is far simpler than running an indexer.
 * If the collection ever grows past what a single RPC page returns
 * comfortably, this is the first thing to replace.
 */
export const fetchAllPositions = async (program: AnsemProgram) => {
  const all = await program.account.position.all();
  return all.map((a) => ({
    pubkey: a.publicKey,
    data: decodePosition(a.account),
  }));
};

/** Token amounts are stored as integers; mints here use 6 decimals. */
export const DECIMALS = 6;
/** Must match `PRECISION` in the on-chain program (`state.rs`). */
export const REWARD_PRECISION = 1_000_000_000_000n;
export const toUi = (raw: number) => raw / 10 ** DECIMALS;
export const fmtToken = (raw: number, digits = 4) =>
  toUi(raw).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });

/**
 * Vault balance as the UI should show it: settled vault + pending
 * earnings for active positions (same formula as settle_position).
 * Inactive pieces only show what is already banked in the vault.
 */
export const displayVaultBalance = (
  position: Position | null | undefined,
  accRewardPerWeight: string
): number => {
  if (!position) return 0;
  try {
    const vault = BigInt(position.vaultBalance);
    if (!position.active) return Number(vault);

    const acc = BigInt(accRewardPerWeight);
    const debt = BigInt(position.rewardDebt);
    const weight = BigInt(position.effectiveWeight);
    const pending =
      acc > debt ? ((acc - debt) * weight) / REWARD_PRECISION : 0n;
    return Number(vault + pending);
  } catch {
    return position.vaultBalance;
  }
};

/** Weights are integers against a base of 100, so 350 reads as 3.5x. */
export const fmtMultiplier = (weight: number) =>
  `${(weight / 100).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })}x`;

export const shortKey = (k: PublicKey | string, n = 4) => {
  const s = typeof k === "string" ? k : k.toBase58();
  return `${s.slice(0, n)}…${s.slice(-n)}`;
};

export const makeConnection = (endpoint: string) =>
  new Connection(endpoint, "processed");

/**
 * The instruction that creates `ata`, or null when it already exists.
 *
 * Both halves need the token program that owns the mint, and neither
 * defaults to it. $ANSEM is Token-2022, so:
 *
 *   - `getAccount` without it decodes against the classic program and
 *     throws even when the account is there, so the caller "creates" an
 *     ATA that already exists on every single claim.
 *   - `createAssociatedTokenAccountInstruction` without it builds a
 *     classic-program instruction, while the address was derived for
 *     Token-2022. The ATA program re-derives its own address, finds it
 *     does not match the one passed in, and the transaction dies with
 *     "Provided seeds do not result in a valid address" - an error that
 *     says nothing about token programs and sends you hunting through
 *     the Rust PDAs instead.
 *
 * Shared rather than inlined because the two claim paths had the same
 * three lines, and fixing one would have left the other broken.
 */
export const createAtaIfMissing = async (
  connection: Connection,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey
): Promise<TransactionInstruction | null> => {
  try {
    await getAccount(connection, ata, undefined, tokenProgram);
    return null;
  } catch {
    return createAssociatedTokenAccountInstruction(
      owner,
      ata,
      owner,
      mint,
      tokenProgram
    );
  }
};
