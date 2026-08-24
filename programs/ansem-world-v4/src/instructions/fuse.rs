use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

use crate::{
    core_asset,
    errors::AnsemError,
    math,
    state::{FuseEntry, FuseFeed, GlobalConfig, Position, RewardState, MAX_ABSORBED},
};

/// Merges one NFT into another. The absorbed NFT is destroyed for
/// good, so the collection can only ever shrink.
///
/// Fusing three is this instruction called twice; the cost table is
/// per step, which makes two calls cost exactly what a single
/// three-way merge would.
/// Every account here is boxed. Thirteen accounts deserialized
/// onto Solana's 4KB stack overflows it outright; boxing moves them
/// to the heap. The failure mode without this is an "access
/// violation in stack frame" at runtime, not a compile error.
#[derive(Accounts)]
pub struct Fuse<'info> {
    /// Must currently hold BOTH NFTs.
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [GlobalConfig::SEED],
        bump = config.bump
    )]
    pub config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [RewardState::SEED],
        bump = reward_state.bump
    )]
    pub reward_state: Box<Account<'info, RewardState>>,

    /// CHECK: Verified against Core state in the handler.
    pub survivor_asset: UncheckedAccount<'info>,

    /// CHECK: Verified against Core state, then burned.
    #[account(mut)]
    pub absorbed_asset: UncheckedAccount<'info>,

    /// CHECK: The collection both assets belong to; Core needs it to
    /// burn a collection member. Pinned to config.
    #[account(
        mut,
        constraint = collection.key() == config.core_collection @ AnsemError::InvalidCollection
    )]
    pub collection: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [Position::SEED, survivor_asset.key().as_ref()],
        bump = survivor.bump,
        constraint = survivor.asset == survivor_asset.key() @ AnsemError::NotAssetOwner
    )]
    pub survivor: Box<Account<'info, Position>>,

    /// Closed once its weight and vault have moved across - the NFT
    /// behind it no longer exists.
    #[account(
        mut,
        close = owner,
        seeds = [Position::SEED, absorbed_asset.key().as_ref()],
        bump = absorbed.bump,
        constraint = absorbed.asset == absorbed_asset.key() @ AnsemError::NotAssetOwner
    )]
    pub absorbed: Box<Account<'info, Position>>,

    #[account(
        mut,
        constraint = ansemw_mint.key() == config.ansemw_mint @ AnsemError::InvalidMint
    )]
    pub ansemw_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = owner_ansemw.owner == owner.key() @ AnsemError::NotAssetOwner,
        constraint = owner_ansemw.mint == config.ansemw_mint @ AnsemError::InvalidMint
    )]
    pub owner_ansemw: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Address-checked against the Core program id.
    #[account(address = crate::core_asset::core_program_id())]
    pub mpl_core_program: UncheckedAccount<'info>,

    /// The public record of this fuse.
    #[account(
        mut,
        seeds = [FuseFeed::SEED],
        bump = fuse_feed.bump
    )]
    pub fuse_feed: Box<Account<'info, FuseFeed>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Fuse>) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, AnsemError::ProtocolPaused);
    require_keys_neq!(
        ctx.accounts.survivor_asset.key(),
        ctx.accounts.absorbed_asset.key(),
        AnsemError::CannotFuseWithSelf
    );
    require!(
        ctx.accounts.survivor.absorbed_count < MAX_ABSORBED,
        AnsemError::FuseLimitReached
    );
    // Fusing closes the absorbed Position and reshapes the survivor. If
    // either carried a stake bonus, the StakeAccount would be left
    // pointing at something that no longer exists as it was focused. The
    // bonus weight is coupled to the position, so it must be unwound
    // through unstake first, not silently here where there is no
    // StakeAccount to update.
    require!(
        ctx.accounts.survivor.stake_bonus_pct == 0
            && ctx.accounts.absorbed.stake_bonus_pct == 0,
        AnsemError::StakeBonusOnFuse
    );

    // Both NFTs must be ours, and both must be from this collection.
    core_asset::verify_owner_and_collection(
        &ctx.accounts.survivor_asset.to_account_info(),
        &ctx.accounts.owner.key(),
        &config.core_collection,
    )?;
    core_asset::verify_owner_and_collection(
        &ctx.accounts.absorbed_asset.to_account_info(),
        &ctx.accounts.owner.key(),
        &config.core_collection,
    )?;

    let cost = config
        .fuse_cost(ctx.accounts.survivor.absorbed_count)
        .ok_or(AnsemError::FuseLimitReached)?;
    let config_snapshot = (**config).clone();

    // `cost` is a whole-token count (matches position tracking and the
    // UI); the CPI needs atomic units.
    token_interface::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.ansemw_mint.to_account_info(),
                from: ctx.accounts.owner_ansemw.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        math::to_atomic(cost, ctx.accounts.ansemw_mint.decimals)?,
    )?;

    // Settle BOTH at their current weights before anything moves,
    // for the same reason upgrade_tier does: otherwise earnings
    // from the past would be recomputed at the post-fuse weight.
    let acc = ctx.accounts.reward_state.acc_reward_per_weight;
    math::settle_position(&mut ctx.accounts.survivor, acc)?;
    math::settle_position(&mut ctx.accounts.absorbed, acc)?;

    // Take both out of the pool, then put the merged one back.
    let reward_state = &mut ctx.accounts.reward_state;
    if ctx.accounts.absorbed.active {
        reward_state.total_weight = reward_state
            .total_weight
            .checked_sub(ctx.accounts.absorbed.effective_weight)
            .ok_or(AnsemError::MathOverflow)?;
    }
    if ctx.accounts.survivor.active {
        reward_state.total_weight = reward_state
            .total_weight
            .checked_sub(ctx.accounts.survivor.effective_weight)
            .ok_or(AnsemError::MathOverflow)?;
    }

    let absorbed_tier = ctx.accounts.absorbed.tier;
    let absorbed_vault = ctx.accounts.absorbed.vault_balance;
    let absorbed_lifetime = ctx.accounts.absorbed.lifetime_earned;
    let absorbed_burned = ctx.accounts.absorbed.cumulative_ansemw_burned;

    let survivor = &mut ctx.accounts.survivor;

    // Whatever the absorbed NFT had banked moves across, so nothing
    // earned is stranded on a token that is about to stop existing.
    survivor.vault_balance = survivor
        .vault_balance
        .checked_add(absorbed_vault)
        .ok_or(AnsemError::MathOverflow)?;
    survivor.lifetime_earned = survivor
        .lifetime_earned
        .checked_add(absorbed_lifetime)
        .ok_or(AnsemError::MathOverflow)?;
    survivor.cumulative_ansemw_burned = survivor
        .cumulative_ansemw_burned
        .checked_add(absorbed_burned)
        .ok_or(AnsemError::MathOverflow)?
        .checked_add(cost)
        .ok_or(AnsemError::MathOverflow)?;

    // Record the part at the rung it came in on. Reforge can raise
    // it later; nothing else may touch it.
    let slot = survivor.absorbed_count as usize;
    survivor.absorbed_tiers[slot] = absorbed_tier;
    survivor.absorbed_count = survivor
        .absorbed_count
        .checked_add(1)
        .ok_or(AnsemError::MathOverflow)?;

    // Weights are derived from the parts, never accumulated.
    survivor
        .refresh_weights(&config_snapshot)
        .ok_or(AnsemError::MathOverflow)?;

    if survivor.active {
        reward_state.total_weight = reward_state
            .total_weight
            .checked_add(survivor.effective_weight)
            .ok_or(AnsemError::MathOverflow)?;
    }

    // How many NFTs the survivor is now made of, counting itself.
    let parts = survivor
        .absorbed_count
        .checked_add(1)
        .ok_or(AnsemError::MathOverflow)?;

    ctx.accounts.fuse_feed.push(FuseEntry {
        survivor: ctx.accounts.survivor_asset.key(),
        absorbed: ctx.accounts.absorbed_asset.key(),
        ansemw_burned: cost,
        slot: Clock::get()?.slot,
        parts,
    });

    burn_core_asset(&ctx)?;

    Ok(())
}

/// Destroys the absorbed NFT through Metaplex Core.
///
/// The instruction is built by hand rather than with mpl-core's CPI
/// builder: that builder speaks a newer solana-program than Anchor
/// does, and the AccountInfo types are not interchangeable. The
/// layout is fixed and small, so encoding it directly is simpler
/// than bridging the two.
fn burn_core_asset(ctx: &Context<Fuse>) -> Result<()> {
    let core_id = ctx.accounts.mpl_core_program.key();

    // BurnV1: discriminator 12, then compression_proof = None.
    let data = vec![12u8, 0u8];

    let accounts = vec![
        AccountMeta::new(ctx.accounts.absorbed_asset.key(), false),
        AccountMeta::new(ctx.accounts.collection.key(), false),
        AccountMeta::new(ctx.accounts.owner.key(), true),
        AccountMeta::new_readonly(ctx.accounts.owner.key(), true),
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        // log_wrapper is optional; passing the program id means none.
        AccountMeta::new_readonly(core_id, false),
    ];

    invoke(
        &Instruction {
            program_id: core_id,
            accounts,
            data,
        },
        &[
            ctx.accounts.absorbed_asset.to_account_info(),
            ctx.accounts.collection.to_account_info(),
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.mpl_core_program.to_account_info(),
        ],
    )?;

    Ok(())
}
