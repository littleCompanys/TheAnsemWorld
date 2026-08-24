use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

use crate::{
    core_asset,
    errors::AnsemError,
    math,
    state::{GlobalConfig, Position, RewardState, TIER_COUNT},
};

/// Raises the rung of one part already absorbed into a fused NFT.
///
/// Absorbed parts freeze at whatever tier they carried when they
/// went in, and `upgrade_tier` deliberately only moves the NFT's
/// own rung. Without this, fusing early would permanently cap those
/// parts - so the optimal play would always be "max everything
/// before fusing", and anyone who fused first would be punished for
/// it. Reforge prices the climb off the same table, which makes the
/// order of operations irrelevant.
///
/// Note this burns $ANSEMW, not NFTs. Fusing is what destroys NFTs.
#[derive(Accounts)]
pub struct Reforge<'info> {
    /// Must be the wallet currently holding the NFT.
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

    /// CHECK: Verified in the handler against Core state.
    pub asset: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [Position::SEED, asset.key().as_ref()],
        bump = position.bump,
        constraint = position.asset == asset.key() @ AnsemError::NotAssetOwner
    )]
    pub position: Box<Account<'info, Position>>,

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

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Reforge>, part_index: u8, target_tier: u8) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, AnsemError::ProtocolPaused);
    require!(target_tier as usize <= TIER_COUNT, AnsemError::InvalidTier);
    require!(
        part_index < ctx.accounts.position.absorbed_count,
        AnsemError::NoSuchPart
    );

    let current_tier = ctx.accounts.position.absorbed_tiers[part_index as usize];
    require!(target_tier > current_tier, AnsemError::NotAnUpgrade);

    core_asset::verify_owner_and_collection(
        &ctx.accounts.asset.to_account_info(),
        &ctx.accounts.owner.key(),
        &config.core_collection,
    )?;

    // Same table as upgrade_tier, so raising a part after the fuse
    // costs exactly what raising the NFT before it would have.
    let cost = config
        .upgrade_cost(current_tier, target_tier)
        .ok_or(AnsemError::InvalidTier)?;
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

    // Settle at the old weight first, for the same reason as every
    // other weight change: otherwise the past would be repriced.
    math::settle_position(
        &mut ctx.accounts.position,
        ctx.accounts.reward_state.acc_reward_per_weight,
    )?;

    let old_weight = ctx.accounts.position.effective_weight;

    let position = &mut ctx.accounts.position;
    position.absorbed_tiers[part_index as usize] = target_tier;
    position
        .refresh_weights(&config_snapshot)
        .ok_or(AnsemError::MathOverflow)?;
    let new_weight = position.effective_weight;

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
