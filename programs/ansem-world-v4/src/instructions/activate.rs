use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

use crate::{
    core_asset,
    errors::AnsemError,
    math::to_atomic,
    state::{GlobalConfig, Position, RewardState},
};

#[derive(Accounts)]
pub struct Activate<'info> {
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

    /// CHECK: Validated in the handler against Metaplex Core state:
    /// must be a real Core Asset, held by `owner`, and part of
    /// `config.core_collection`.
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

pub fn handler(ctx: Context<Activate>) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, AnsemError::ProtocolPaused);
    require!(!ctx.accounts.position.active, AnsemError::AlreadyActive);

    // Prove on-chain that the signer really holds this NFT and that
    // it is one of ours, before any tokens are burned.
    core_asset::verify_owner_and_collection(
        &ctx.accounts.asset.to_account_info(),
        &ctx.accounts.owner.key(),
        &config.core_collection,
    )?;

    let cost = config.activation_cost;

    // Real burn through the SPL Token Program - the $ANSEMW is
    // destroyed, not parked in a treasury. `cost` is a whole-token
    // count (matches position tracking and the UI); the CPI needs
    // atomic units.
    token_interface::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.ansemw_mint.to_account_info(),
                from: ctx.accounts.owner_ansemw.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        to_atomic(cost, ctx.accounts.ansemw_mint.decimals)?,
    )?;

    let reward_state = &mut ctx.accounts.reward_state;
    let position = &mut ctx.accounts.position;

    // CRITICAL: snapshot the accumulator at activation time.
    // Without this the position would start at reward_debt = 0 and
    // retroactively harvest every reward ever distributed the first
    // time it settles.
    position.reward_debt = reward_state.acc_reward_per_weight;

    position.active = true;
    position.activation_owner = ctx.accounts.owner.key();
    position.cumulative_ansemw_burned = position
        .cumulative_ansemw_burned
        .checked_add(cost)
        .ok_or(AnsemError::MathOverflow)?;

    reward_state.total_weight = reward_state
        .total_weight
        .checked_add(position.effective_weight)
        .ok_or(AnsemError::MathOverflow)?;

    Ok(())
}
