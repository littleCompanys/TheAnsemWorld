use anchor_lang::prelude::*;

use crate::{errors::AnsemError, state::GlobalConfig};

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [GlobalConfig::SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ AnsemError::Unauthorized
    )]
    pub config: Account<'info, GlobalConfig>,
}

/// Emergency stop.
///
/// Deliberately limited: pausing blocks the economic entry points
/// (activate, upgrade, fund, claim) but NOT settle_position or
/// sync_owner. Those two move no tokens and only ever push the
/// accounting forward, so leaving them open means a pause cannot
/// freeze the books in a state that quietly favours anyone.
///
/// Note the trade-off this creates: because claim is blocked, an
/// authority that pauses and walks away leaves balances stranded.
/// That is real centralization risk, and the mitigation belongs at
/// the key level - a multisig or timelock as authority - not in
/// this instruction.
pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

/// Hands the protocol to a new authority, typically to move from a
/// deployer keypair to a multisig.
pub fn transfer_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
    require_keys_neq!(
        new_authority,
        Pubkey::default(),
        AnsemError::Unauthorized
    );
    ctx.accounts.config.authority = new_authority;
    Ok(())
}

/// Changes the wake-up fee. Tier pricing is intentionally NOT
/// adjustable here: those thresholds and weights are fixed at
/// initialization, because an authority able to move them could
/// dilute every holder's share.
pub fn set_activation_cost(ctx: Context<AdminOnly>, cost: u64) -> Result<()> {
    ctx.accounts.config.activation_cost = cost;
    Ok(())
}

/// Updates the SOL price charged per mint. Useful for launch price
/// vs. secondary price adjustments.
pub fn set_mint_price(ctx: Context<AdminOnly>, price: u64) -> Result<()> {
    ctx.accounts.config.mint_price = price;
    Ok(())
}

/// Updates the hard supply cap. Can only be lowered or kept at the
/// current value — raising it after launch is a rug vector (inflates
/// supply after buyers locked in at a scarcity assumption). Passing 0
/// removes the cap entirely, which is an explicit unlimited choice.
///
/// The one exception is raising from 0 (unlimited) to a finite cap:
/// that is always permitted because it is strictly more restrictive.
pub fn set_max_supply(ctx: Context<AdminOnly>, max: u32) -> Result<()> {
    let current_max = ctx.accounts.config.max_supply;
    let supply_so_far = ctx.accounts.config.current_supply;
    // Must not be tighter than what has already been minted.
    if max > 0 {
        require!(max >= supply_so_far, AnsemError::MintSupplyExhausted);
    }
    // Cannot raise an already-set cap (except from 0 = unlimited).
    if current_max > 0 && max > 0 {
        require!(max <= current_max, AnsemError::Unauthorized);
    }
    ctx.accounts.config.max_supply = max;
    Ok(())
}
