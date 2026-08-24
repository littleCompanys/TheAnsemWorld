use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

use crate::{
    core_asset,
    errors::AnsemError,
    math,
    state::{GlobalConfig, Position, RewardState, TIER_COUNT},
};

#[derive(Accounts)]
pub struct UpgradeTier<'info> {
    /// Must be the wallet currently holding the NFT.
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [GlobalConfig::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [RewardState::SEED],
        bump = reward_state.bump
    )]
    pub reward_state: Account<'info, RewardState>,

    /// CHECK: Verified in the handler against Core state.
    pub asset: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [Position::SEED, asset.key().as_ref()],
        bump = position.bump,
        constraint = position.asset == asset.key() @ AnsemError::NotAssetOwner
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        constraint = ansemw_mint.key() == config.ansemw_mint @ AnsemError::InvalidMint
    )]
    pub ansemw_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = owner_ansemw.owner == owner.key() @ AnsemError::NotAssetOwner,
        constraint = owner_ansemw.mint == config.ansemw_mint @ AnsemError::InvalidMint
    )]
    pub owner_ansemw: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<UpgradeTier>, target_tier: u8) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, AnsemError::ProtocolPaused);
    require!(
        target_tier as usize <= TIER_COUNT,
        AnsemError::InvalidTier
    );
    require!(
        target_tier > ctx.accounts.position.tier,
        AnsemError::NotAnUpgrade
    );

    core_asset::verify_owner_and_collection(
        &ctx.accounts.asset.to_account_info(),
        &ctx.accounts.owner.key(),
        &config.core_collection,
    )?;

    let cost = config
        .upgrade_cost(ctx.accounts.position.tier, target_tier)
        .ok_or(AnsemError::InvalidTier)?;

    let config_snapshot = config.clone();

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

    // ORDER MATTERS. Settle at the OLD weight before touching it,
    // otherwise everything earned since the last settlement would
    // be recomputed at the new, higher weight - paying the upgrade
    // retroactively over a period the NFT never held that tier.
    math::settle_position(
        &mut ctx.accounts.position,
        ctx.accounts.reward_state.acc_reward_per_weight,
    )?;

    let old_weight = ctx.accounts.position.effective_weight;

    // Only the NFT's own rung moves; absorbed parts keep theirs.
    // Deriving the weight from the parts is what makes that safe.
    let position = &mut ctx.accounts.position;
    position.tier = target_tier;
    position
        .refresh_weights(&config_snapshot)
        .ok_or(AnsemError::MathOverflow)?;
    let new_weight = position.effective_weight;

    // Only positions currently in the pool carry weight there. An
    // asleep NFT may still upgrade; its weight joins on activation.
    if position.active {
        let reward_state = &mut ctx.accounts.reward_state;
        reward_state.total_weight = reward_state
            .total_weight
            .checked_sub(old_weight)
            .ok_or(AnsemError::MathOverflow)?
            .checked_add(new_weight)
            .ok_or(AnsemError::MathOverflow)?;
    }
    position.cumulative_ansemw_burned = position
        .cumulative_ansemw_burned
        .checked_add(cost)
        .ok_or(AnsemError::MathOverflow)?;

    Ok(())
}
