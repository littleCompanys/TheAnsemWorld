use anchor_lang::prelude::*;

use crate::{
    math,
    state::{Position, RewardState},
};

/// Fully permissionless - it takes no signer at all. It cannot
/// decide balances, it only applies accounting the program already
/// computed, so anyone (holder, keeper, bot) may push a position
/// forward. Nothing here can move tokens.
#[derive(Accounts)]
pub struct SettlePosition<'info> {
    #[account(
        mut,
        seeds = [Position::SEED, position.asset.as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,

    #[account(
        seeds = [RewardState::SEED],
        bump = reward_state.bump
    )]
    pub reward_state: Account<'info, RewardState>,
}

pub fn handler(ctx: Context<SettlePosition>) -> Result<()> {
    math::settle_position(
        &mut ctx.accounts.position,
        ctx.accounts.reward_state.acc_reward_per_weight,
    )
}
