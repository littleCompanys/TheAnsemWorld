use anchor_lang::prelude::*;

use crate::{
    core_asset,
    errors::AnsemError,
    math,
    state::{GlobalConfig, Position, RewardState},
};

/// Puts a sold NFT back to sleep.
///
/// Permissionless and takes no signer: it can only ever move a
/// position from active to asleep, which is never profitable to
/// trigger against someone. The guard is the ownership comparison -
/// it refuses to run while the activating wallet still holds the
/// NFT, so it cannot be used to grief an untouched position.
#[derive(Accounts)]
pub struct SyncOwner<'info> {
    /// CHECK: Verified in the handler as a real Core Asset; its
    /// recorded holder is what decides whether anything happens.
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
        seeds = [RewardState::SEED],
        bump = reward_state.bump
    )]
    pub reward_state: Account<'info, RewardState>,

    /// Needed to recompute the piece's weight after stripping any stake
    /// bonus. Read-only.
    #[account(seeds = [GlobalConfig::SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
}

pub fn handler(ctx: Context<SyncOwner>) -> Result<()> {
    require!(ctx.accounts.position.active, AnsemError::NotActive);

    let current = core_asset::current_owner(&ctx.accounts.asset.to_account_info())?;

    // Still with the wallet that activated it - nothing to do.
    require!(
        current != ctx.accounts.position.activation_owner,
        AnsemError::ActivationOwnerMismatch
    );

    // Credit everything earned up to this moment BEFORE the weight
    // leaves the pool. The balance stays on the Position, so it
    // travels to the new holder along with the NFT.
    math::settle_position(
        &mut ctx.accounts.position,
        ctx.accounts.reward_state.acc_reward_per_weight,
    )?;

    let reward_state = &mut ctx.accounts.reward_state;
    reward_state.total_weight = reward_state
        .total_weight
        .checked_sub(ctx.accounts.position.effective_weight)
        .ok_or(AnsemError::MathOverflow)?;

    // A sale ends the seller's stake focus on this piece. Clear the
    // bonus and rebuild the weight without it, so the buyer cannot
    // reactivate into a boost they never staked for. The stake itself
    // (the seller's locked $ANSEMW) is untouched; unstake still returns
    // it, and finds the bonus already gone here.
    let position = &mut ctx.accounts.position;
    position.stake_bonus_pct = 0;
    position
        .refresh_weights(&ctx.accounts.config)
        .ok_or(AnsemError::MathOverflow)?;
    position.active = false;
    position.activation_owner = Pubkey::default();

    // tier, cumulative_ansemw_burned and vault_balance are all left
    // untouched: they belong to the NFT and survive the sale.

    Ok(())
}
