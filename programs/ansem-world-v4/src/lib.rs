use anchor_lang::prelude::*;

pub mod core_asset;
pub mod errors;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("8gg4uxSoMLMx4nVquLQFRf7s9mr6L9AVT7bP8hnN7hZo");

#[program]
pub mod ansem_world_v4 {
    use super::*;

    /// Creates the two protocol-wide accounts (GlobalConfig,
    /// RewardState). Must be called exactly once, before anything
    /// else in the program can run.
    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        args: InitializeProtocolArgs,
    ) -> Result<()> {
        initialize_protocol::handler(ctx, args)
    }

    /// Creates the public fuse feed. Call once after
    /// initialize_protocol; fuse() cannot run without it.
    pub fn initialize_fuse_feed(ctx: Context<InitializeFuseFeed>) -> Result<()> {
        initialize_fuse_feed::handler(ctx)
    }

    /// Creates the Position PDA for one NFT. Starts inactive with
    /// zero economic effect - activate() is what turns it on.
    pub fn initialize_position(ctx: Context<InitializePosition>) -> Result<()> {
        initialize_position::handler(ctx)
    }

    /// Burns the configured amount of $ANSEMW and switches the
    /// position on, adding its weight to the global total.
    pub fn activate(ctx: Context<Activate>) -> Result<()> {
        activate::handler(ctx)
    }

    /// Deposits $ANSEM into the reward vault and spreads it across
    /// all currently active weight via the global accumulator.
    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        fund_rewards::handler(ctx, amount)
    }

    /// Credits a position's accrued earnings into the NFT's own
    /// vault. Permissionless - moves no tokens.
    pub fn settle_position(ctx: Context<SettlePosition>) -> Result<()> {
        settle_position::handler(ctx)
    }

    /// Withdraws the NFT's vault balance to the current holder's
    /// wallet. Settles first, so it always pays out everything
    /// earned up to this instant.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        claim::handler(ctx)
    }

    /// Puts a position to sleep once the NFT has changed hands.
    /// Permissionless; the new holder must burn $ANSEMW to wake it.
    pub fn sync_owner(ctx: Context<SyncOwner>) -> Result<()> {
        sync_owner::handler(ctx)
    }

    /// Burns the difference in $ANSEMW to move the NFT up to
    /// `target_tier`, permanently raising what it earns. The tier
    /// stays with the NFT through any future sale.
    pub fn upgrade_tier(ctx: Context<UpgradeTier>, target_tier: u8) -> Result<()> {
        upgrade_tier::handler(ctx, target_tier)
    }

    /// Emergency stop. Blocks activate/upgrade/fund/claim; leaves
    /// settle_position and sync_owner working.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        admin::set_paused(ctx, paused)
    }

    /// Moves protocol control to a new key, e.g. a multisig.
    pub fn transfer_authority(
        ctx: Context<AdminOnly>,
        new_authority: Pubkey,
    ) -> Result<()> {
        admin::transfer_authority(ctx, new_authority)
    }

    /// Adjusts the wake-up fee, up to MAX_ACTIVATION_COST. Tier
    /// pricing stays immutable.
    pub fn set_activation_cost(ctx: Context<AdminOnly>, cost: u64) -> Result<()> {
        admin::set_activation_cost(ctx, cost)
    }

    /// Merges one NFT into another: weights add, a bonus applies,
    /// the absorbed NFT is burned and its vault moves across.
    pub fn fuse(ctx: Context<Fuse>) -> Result<()> {
        fuse::handler(ctx)
    }

    /// Raises the tier of one part already fused into this NFT,
    /// priced off the same table as a normal upgrade.
    pub fn reforge(
        ctx: Context<Reforge>,
        part_index: u8,
        target_tier: u8,
    ) -> Result<()> {
        reforge::handler(ctx, part_index, target_tier)
    }

    /// Sends collected revenue to the fixed treasury address so a
    /// keeper can swap it for $ANSEM off-chain and fund rewards.
    pub fn withdraw_treasury(
        ctx: Context<WithdrawTreasury>,
        amount: u64,
    ) -> Result<()> {
        treasury::withdraw(ctx, amount)
    }

    /// Transfers the Core collection's update authority to the
    /// GlobalConfig PDA, locking all future minting behind this
    /// program. Must be called before mint_nft will work.
    pub fn claim_collection_authority(
        ctx: Context<ClaimCollectionAuthority>,
    ) -> Result<()> {
        claim_collection_authority::handler(ctx)
    }

    /// Mints one World Piece NFT from the official collection and
    /// creates the corresponding Position PDA in one transaction.
    /// Charges mint_price SOL to the treasury.
    ///
    /// Takes no metadata: name and URI are derived from base_uri and
    /// the mint counter, so which piece a buyer gets is decided by
    /// when they minted, not by what they asked for.
    pub fn mint_nft(ctx: Context<MintNft>) -> Result<()> {
        mint_nft::handler(ctx)
    }

    /// Updates the SOL price per mint.
    pub fn set_mint_price(ctx: Context<AdminOnly>, price: u64) -> Result<()> {
        admin::set_mint_price(ctx, price)
    }

    /// Updates the hard supply cap.
    pub fn set_max_supply(ctx: Context<AdminOnly>, max: u32) -> Result<()> {
        admin::set_max_supply(ctx, max)
    }

    /// Corrects the metadata prefix. Only works before the first mint.
    pub fn set_base_uri(ctx: Context<AdminOnly>, base_uri: String) -> Result<()> {
        admin::set_base_uri(ctx, base_uri)
    }

    /// Updates the Core collection's name and/or URI via a signed CPI.
    /// The config PDA is the collection's update authority after
    /// `claim_collection_authority` has run, so this is the only way
    /// to fix a wrong/placeholder collection URI after launch.
    pub fn update_collection_metadata(
        ctx: Context<UpdateCollectionMetadata>,
        new_name: Option<String>,
        new_uri: Option<String>,
    ) -> Result<()> {
        update_collection_metadata::handler(ctx, new_name, new_uri)
    }

    /// Clears a position whose NFT was burned outside fuse, returning
    /// its stranded weight to the pool. Permissionless.
    pub fn reap_burned(ctx: Context<ReapBurned>) -> Result<()> {
        reap_burned::handler(ctx)
    }

    /// Creates the vault that holds locked $ANSEMW. Call once, after
    /// initialize_protocol and before the first stake.
    pub fn initialize_stake_vault(ctx: Context<InitializeStakeVault>) -> Result<()> {
        initialize_stake_vault::handler(ctx)
    }

    /// Locks $ANSEMW against one active piece, raising its earning bonus.
    /// One lock per piece; call again on the same piece to top up.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        stake::stake(ctx, amount)
    }

    /// Returns the $ANSEMW locked against one piece and clears its bonus.
    /// No fee, no cooldown. Other staked pieces are untouched.
    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        stake::unstake(ctx)
    }
}
