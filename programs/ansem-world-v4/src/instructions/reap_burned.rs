use anchor_lang::prelude::*;

use crate::{
    core_asset,
    errors::AnsemError,
    state::{Position, RewardState},
};

/// Removes a position whose NFT no longer exists.
///
/// A holder can burn their own Core asset directly through Metaplex,
/// outside `fuse`. Nothing in this program hears about it, so the
/// Position survives with `active = true` and its weight still counted
/// in `RewardState::total_weight`.
///
/// That matters because `total_weight` is the denominator of every
/// reward round: `delta = amount * PRECISION / total_weight`. A stale
/// entry means each funding is divided among more weight than actually
/// exists, so every remaining holder earns slightly less and the
/// difference accrues to a vault nobody can ever claim - `claim`
/// requires proving ownership of an asset that is gone. The $ANSEM is
/// not redistributed; it sits in the reward vault forever.
///
/// `sync_owner` cannot clean this up: it reads the holder from Core,
/// and a burned asset's account is closed and owned by the System
/// Program, so its `NotACoreAsset` guard reverts. Without this
/// instruction `total_weight` can only ever drift upward, and the only
/// repair would be a program upgrade.
///
/// Permissionless and unsigned by design. It can only ever run against
/// an asset that provably does not exist, so there is no one to use it
/// against; anyone diluted by the stale weight can fix it themselves,
/// and the rent refund pays for the transaction.
#[derive(Accounts)]
pub struct ReapBurned<'info> {
    /// CHECK: the point of this instruction is that this account is
    /// *gone*. The handler proves it is no longer a live Core asset
    /// before touching anything.
    pub asset: UncheckedAccount<'info>,

    #[account(
        mut,
        close = rent_receiver,
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

    /// Whoever pays for the cleanup gets the Position's rent.
    /// CHECK: only receives lamports.
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<ReapBurned>) -> Result<()> {
    // Prove the asset is really gone before removing anything, using
    // the same readability test the rest of the program trusts. If Core
    // no longer serves this account as an asset, then activate, claim,
    // fuse and sync_owner are all equally locked out of it - the
    // position can never be reached again by any other route.
    require!(
        !core_asset::is_live(&ctx.accounts.asset.to_account_info()),
        AnsemError::AssetStillExists
    );

    // Deliberately NOT settled first. Settling would credit earnings
    // into a vault that is about to be closed and can never be
    // withdrawn; leaving them unsettled keeps that $ANSEM in the pool
    // for the holders who are still here.
    if ctx.accounts.position.active {
        let reward_state = &mut ctx.accounts.reward_state;
        reward_state.total_weight = reward_state
            .total_weight
            .checked_sub(ctx.accounts.position.effective_weight)
            .ok_or(AnsemError::MathOverflow)?;
    }

    // The Position account is closed by the `close` constraint above.
    Ok(())
}
