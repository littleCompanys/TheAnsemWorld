use anchor_lang::prelude::*;

/// Fixed-point precision used by the reward accumulator math.
/// Solana has no floating point, so we scale up before dividing
/// and scale back down when reading the final amount.
pub const PRECISION: u128 = 1_000_000_000_000;

/// Number of tiers, from base (1) to top (5).
pub const TIER_COUNT: usize = 5;

/// A fused NFT earns on the combined weight of its parts, lifted by
/// a bonus. Indexed by how many NFTs were absorbed: 0 (untouched),
/// 1 (two parts, +20%), 2 (three parts, +30%). Three is the ceiling.
pub const FUSE_BONUS_PCT: [u64; 3] = [100, 120, 130];

/// An NFT may absorb at most two others, for three parts total.
pub const MAX_ABSORBED: u8 = 2;

/// One per protocol. Seed: ["config"].
/// Holds every address/parameter the rest of the program needs to
/// trust (which mints are real, which collection is official, who
/// is allowed to change settings).
#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub authority: Pubkey,

    // Tokens
    pub ansem_mint: Pubkey,
    pub ansemw_mint: Pubkey,

    // Metaplex Core
    pub core_collection: Pubkey,

    // Protocol
    pub treasury: Pubkey,

    /// Amount of $ANSEMW burned to wake a sleeping NFT. Charged on
    /// every activation, including after a resale. It does not move
    /// the NFT up a tier - tiers are bought separately.
    pub activation_cost: u64,

    /// Cumulative $ANSEMW required to reach each tier, indexed by
    /// tier - 1. Upgrading charges the difference between two
    /// entries, which is what makes climbing in steps cost exactly
    /// the same as jumping straight to the top.
    ///
    /// Set once at initialization and never mutable afterwards: an
    /// authority able to move these could dilute every holder.
    pub tier_thresholds: [u64; TIER_COUNT],

    /// Earning weight at each tier, indexed by tier - 1. Integers
    /// rather than multipliers, so there is no rounding anywhere in
    /// the reward math.
    pub tier_weights: [u64; TIER_COUNT],

    /// $ANSEMW burned to absorb the Nth NFT: index 0 is the second
    /// part, index 1 the third. Fixed at initialization for the
    /// same reason the tier table is.
    pub fuse_costs: [u64; MAX_ABSORBED as usize],

    pub paused: bool,
    pub bump: u8,
    /// Bump of the reward vault PDA. Stored so instructions that
    /// move tokens out of the vault can sign deterministically
    /// instead of guessing.
    pub reward_vault_bump: u8,

    // ── Mint mechanics ───────────────────────────────────────────────
    /// SOL price (lamports) per NFT mint. Flows to treasury.
    /// Settable by the authority after launch.
    pub mint_price: u64,
    /// Hard cap on total supply. Zero means unlimited.
    pub max_supply: u32,
    /// Number of NFTs ever minted through this program.
    pub current_supply: u32,
    /// True once claim_collection_authority has run. Guards mint_nft:
    /// the instruction would panic without a valid PDA signature.
    pub collection_claimed: bool,

    /// Prefix every piece's metadata URI is built from. The full URI is
    /// `{base_uri}{index}.json`, where index is the piece's mint order.
    ///
    /// This is what keeps metadata out of the caller's hands. mint_nft
    /// takes no name or uri argument at all, so the art a buyer receives
    /// is decided by when they minted, not by what they asked for -
    /// which is verifiable by anyone reading the chain.
    ///
    /// Mutable only while current_supply is 0, so a typo is fixable
    /// before the first mint and frozen forever after.
    #[max_len(128)]
    pub base_uri: String,

    /// Room for fields added later. Anchor lays accounts out in
    /// declaration order, so growing a live account means reallocating
    /// every one of them; paying for the space up front is far cheaper
    /// than migrating thousands of PDAs afterwards.
    pub reserved: [u8; 64],
}

impl GlobalConfig {
    pub const SEED: &'static [u8] = b"config";

    /// Cumulative cost of moving from `from` to `to`. Because the
    /// table stores cumulative totals, this telescopes: 1->3 costs
    /// the same as 1->2 followed by 2->3.
    pub fn upgrade_cost(&self, from: u8, to: u8) -> Option<u64> {
        let from_total = *self.tier_thresholds.get(from.checked_sub(1)? as usize)?;
        let to_total = *self.tier_thresholds.get(to.checked_sub(1)? as usize)?;
        to_total.checked_sub(from_total)
    }

    pub fn weight_for_tier(&self, tier: u8) -> Option<u64> {
        self.tier_weights.get(tier.checked_sub(1)? as usize).copied()
    }

    /// Cost of absorbing one more NFT into a position that has
    /// already absorbed `absorbed_count`.
    pub fn fuse_cost(&self, absorbed_count: u8) -> Option<u64> {
        self.fuse_costs.get(absorbed_count as usize).copied()
    }
}

/// One per protocol. Seed: ["reward_state"].
/// Global accounting for the accumulator-based reward math, so we
/// never have to loop over every NFT when rewards are funded.
#[account]
#[derive(InitSpace)]
pub struct RewardState {
    /// Sum of effective_weight from all currently active positions.
    pub total_weight: u64,
    /// Global reward-per-weight accumulator (scaled by PRECISION).
    pub acc_reward_per_weight: u128,
    /// Total $ANSEM ever credited into the accounting (may exceed
    /// what's claimable due to rounding dust).
    pub total_allocated: u64,
    /// Total $ANSEM ever paid out via claim().
    pub total_claimed: u64,
    pub bump: u8,
    /// See GlobalConfig::reserved.
    pub reserved: [u8; 64],
}

impl RewardState {
    pub const SEED: &'static [u8] = b"reward_state";
}

/// One per NFT. Seed: ["position", asset_pubkey].
/// Represents an NFT's *ability* to generate reward - not the
/// reward itself. Rewards earned settle into UserReward, keyed by
/// wallet, so they survive the NFT being sold.
#[account]
#[derive(InitSpace)]
pub struct Position {
    /// The Metaplex Core Asset address this position tracks.
    pub asset: Pubkey,
    /// Wallet that called activate() for this NFT. Zeroed out while
    /// inactive.
    pub activation_owner: Pubkey,
    pub active: bool,
    /// Reserved for future tier upgrades. Starts at 1.
    pub tier: u8,
    /// Weight before any future tier/fuse bonuses.
    pub base_weight: u64,
    /// The weight actually used in reward math right now.
    pub effective_weight: u64,
    /// Snapshot of RewardState.acc_reward_per_weight the last time
    /// this position's earnings were settled into a UserReward.
    pub reward_debt: u128,
    /// Total $ANSEMW ever burned to (re)activate this NFT.
    pub cumulative_ansemw_burned: u64,
    /// How many other NFTs this one has absorbed. Drives the fuse
    /// bonus and, with it, the ceiling on further fusing.
    pub absorbed_count: u8,
    /// Tier of each absorbed part, in the order they were taken in.
    /// Only the first `absorbed_count` entries mean anything.
    /// Reforge raises these; upgrade_tier never touches them.
    pub absorbed_tiers: [u8; MAX_ABSORBED as usize],
    /// $ANSEM credited to this NFT and not yet withdrawn.
    /// This is the NFT's vault: it belongs to the token, not to a
    /// wallet, so it travels with the NFT when it is sold. Only the
    /// current holder can withdraw it, and only to their own wallet.
    pub vault_balance: u64,
    /// Lifetime $ANSEM ever credited to this NFT, for display.
    pub lifetime_earned: u64,
    /// Stake bonus currently applied to this piece, as a percentage
    /// (0, 5, 10, 15, 20, 25). Set when a wallet focuses its $ANSEMW
    /// stake here, cleared on unstake and on a sale. Only ever nonzero
    /// while the staker still holds and has activated the piece.
    pub stake_bonus_pct: u8,
    pub bump: u8,
    /// See GlobalConfig::reserved. Costs ~0.00045 SOL of extra rent per
    /// piece, paid by the buyer at mint - the price of never having to
    /// realloc 3,333 accounts.
    pub reserved: [u8; 64],
}

impl Position {
    pub const SEED: &'static [u8] = b"position";

    /// Earning weight after both bonuses: the fuse bonus (from parts
    /// absorbed) and the stake bonus (from $ANSEMW locked and focused
    /// here). Combined in one division so there is at most one rounding
    /// step: base x fuse% x (100 + stake%) / 10000.
    ///
    /// The stake bonus caps at +25%, deliberately under fuse's +30%: a
    /// permanent burn should always beat a reversible lock.
    pub fn weight_with_bonus(&self) -> Option<u64> {
        let fuse = *FUSE_BONUS_PCT.get(self.absorbed_count as usize)?;
        let stake = 100u64.checked_add(self.stake_bonus_pct as u64)?;
        self.base_weight
            .checked_mul(fuse)?
            .checked_mul(stake)?
            .checked_div(10_000)
    }

    /// Rebuilds base weight from what the NFT actually is: its own
    /// rung plus every absorbed part's rung.
    ///
    /// Derived rather than accumulated on purpose. Nudging a running
    /// total is how the earlier upgrade_tier bug erased absorbed
    /// weight; recomputing from the parts cannot drift.
    pub fn recompute_base_weight(&self, config: &GlobalConfig) -> Option<u64> {
        let mut total = config.weight_for_tier(self.tier)?;
        for i in 0..self.absorbed_count as usize {
            total = total.checked_add(config.weight_for_tier(self.absorbed_tiers[i])?)?;
        }
        Some(total)
    }

    /// Applies both steps at once: rebuild the base, then the bonus.
    pub fn refresh_weights(&mut self, config: &GlobalConfig) -> Option<()> {
        self.base_weight = self.recompute_base_weight(config)?;
        self.effective_weight = self.weight_with_bonus()?;
        Some(())
    }
}

/// Program-owned SOL account. Seed: ["treasury"].
///
/// Where protocol revenue lands: NFT resale royalties and trading
/// fees. Anyone can pay into it - it is a plain address as far as
/// the sender is concerned - but only the authority can move funds
/// out, and only to be converted into $ANSEM.
///
/// Conversion itself is deliberately NOT here. Swapping through
/// Jupiter is an off-chain keeper job; this program stays the
/// source of truth for reward accounting and never lets a swap
/// result decide what anyone is owed.
#[account]
#[derive(InitSpace)]
pub struct Treasury {
    /// Lamports ever taken out for conversion. Current holdings are
    /// simply the account's balance, so collected-to-date is
    /// balance + withdrawn - rent.
    pub total_withdrawn: u64,
    pub bump: u8,
    /// See GlobalConfig::reserved.
    pub reserved: [u8; 64],
}

impl Treasury {
    pub const SEED: &'static [u8] = b"treasury";
}

/// Seed of the program-owned token account holding all $ANSEM
/// available for rewards. It is its own authority, so the program
/// signs vault transfers with ["reward_vault", bump].
pub const REWARD_VAULT_SEED: &[u8] = b"reward_vault";

/// Seed of the program-owned token account holding all locked $ANSEMW.
/// It is its own authority, so the program signs unlock transfers with
/// ["stake_vault", bump].
pub const STAKE_VAULT_SEED: &[u8] = b"stake_vault";

/// $ANSEMW has six decimals, so one whole token is this many base units.
/// The stake thresholds below are written in whole tokens and scaled by
/// it, because comparing a base-unit balance against a whole-token
/// number silently puts everyone in the top tier.
pub const ANSEMW_DECIMALS: u64 = 1_000_000;

/// Stake tiers: (whole $ANSEMW locked, bonus percentage). Cumulative -
/// the tier is the highest threshold the locked amount reaches. Fixed at
/// launch, like the NFT tier table, for the same reason: an authority
/// able to move these could rewrite everyone's earnings.
///
/// The top bonus (+25%) sits under the three-part fuse bonus (+30%) on
/// purpose. Locking is reversible; a fuse burn is not, and the
/// irreversible choice should always pay more.
pub const STAKE_TIERS: [(u64, u8); 5] = [
    (100_000, 5),
    (250_000, 10),
    (500_000, 15),
    (1_500_000, 20),
    (2_500_000, 25),
];

/// The bonus percentage a locked amount qualifies for, where `amount` is
/// in base units. Below the first threshold there is no bonus.
pub fn stake_bonus_for(amount: u64) -> u8 {
    let mut bonus = 0u8;
    for (threshold, pct) in STAKE_TIERS.iter() {
        let in_base_units = (*threshold).saturating_mul(ANSEMW_DECIMALS);
        if amount >= in_base_units {
            bonus = *pct;
        }
    }
    bonus
}

/// One per (wallet, piece). Seed: ["stake", owner, asset].
/// Holds how much $ANSEMW a wallet has locked against one specific piece.
/// A wallet can hold several of these at once - one per piece it boosts -
/// and each piece's bonus tier is derived from its own lock alone. The
/// bonus itself lives on that piece's Position; this account is the
/// record of what backs it.
#[account]
#[derive(InitSpace)]
pub struct StakeAccount {
    pub owner: Pubkey,
    /// The piece this lock boosts. Fixed for the life of the account -
    /// the seed binds it, so a lock can never drift to another piece.
    pub asset: Pubkey,
    /// $ANSEMW locked against `asset`. The bonus tier is derived from
    /// this, never stored, so the two can never disagree.
    pub amount: u64,
    pub bump: u8,
}

impl StakeAccount {
    pub const SEED: &'static [u8] = b"stake";
}

/// How many fuses the public feed remembers. Older ones roll off.
pub const FUSE_FEED_LEN: usize = 16;

/// One line in the public fuse history.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, InitSpace)]
pub struct FuseEntry {
    /// The NFT that kept its identity.
    pub survivor: Pubkey,
    /// The NFT that was burned.
    pub absorbed: Pubkey,
    /// $ANSEMW burned to pay for this fuse.
    pub ansemw_burned: u64,
    /// Slot the fuse landed in, so the UI can order and date it.
    pub slot: u64,
    /// Parts the survivor is made of after this fuse (2 or 3).
    pub parts: u8,
}

/// One per protocol. Seed: ["fuse_feed"].
///
/// A ring buffer of the most recent fuses. Every fuse is already a
/// permanent on-chain fact, but reconstructing the list would mean
/// scanning transactions. Writing it here costs one account and
/// makes the whole history a single RPC read - no indexer, no
/// backend.
#[account]
#[derive(InitSpace)]
pub struct FuseFeed {
    /// Where the next entry goes. Wraps at FUSE_FEED_LEN.
    pub next_index: u8,
    /// Fuses ever recorded. Above FUSE_FEED_LEN it keeps counting,
    /// which is what lets the UI say "of N total" while only holding
    /// the last few.
    pub total: u64,
    pub bump: u8,
    pub entries: [FuseEntry; FUSE_FEED_LEN],
}

impl FuseFeed {
    pub const SEED: &'static [u8] = b"fuse_feed";

    pub fn push(&mut self, entry: FuseEntry) {
        self.entries[self.next_index as usize] = entry;
        self.next_index = (self.next_index + 1) % FUSE_FEED_LEN as u8;
        self.total = self.total.saturating_add(1);
    }
}

/// Hard ceiling on `activation_cost`, in whole $ANSEMW.
///
/// The authority may tune the wake-up fee, and over the life of a
/// deflationary token it will almost certainly need to come *down*. The
/// ceiling exists for the other direction: without it, one bad value
/// makes `to_atomic` overflow and `activate` reverts for everyone,
/// permanently. 1,000,000 is 40x the launch cost and 0.1% of supply -
/// far above any sane setting, far below anything that breaks the math.
pub const MAX_ACTIVATION_COST: u64 = 1_000_000;

/// Name prefix every minted piece carries: piece N is named
/// "<prefix> #N". Kept beside the URI derivation so the on-chain name
/// and the metadata file it points at can never drift apart.
pub const PIECE_NAME_PREFIX: &str = "The Ansem World";
