use anchor_lang::prelude::*;

use crate::{
    core_asset,
    errors::AnsemError,
    state::{GlobalConfig, Position, MAX_ABSORBED},
};

#[derive(Accounts)]
pub struct InitializePosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [GlobalConfig::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,

    /// CHECK: Verified in the handler to be a real Core Asset in
    /// our collection. Ownership is deliberately not required -
    /// creating an asleep position is harmless, so anyone (a keeper
    /// backfilling the collection, for example) may do it.
    pub asset: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Position::INIT_SPACE,
        seeds = [Position::SEED, asset.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializePosition>) -> Result<()> {
    core_asset::verify_collection(
        &ctx.accounts.asset.to_account_info(),
        &ctx.accounts.config.core_collection,
    )?;

    // Every NFT starts at the bottom tier; upgrades are bought.
    let base = ctx
        .accounts
        .config
        .weight_for_tier(1)
        .ok_or(AnsemError::InvalidTier)?;

    let position = &mut ctx.accounts.position;
    position.asset = ctx.accounts.asset.key();
    position.activation_owner = Pubkey::default();
    position.active = false;
    position.tier = 1;
    position.base_weight = base;
    position.effective_weight = base;
    position.reward_debt = 0;
    position.cumulative_ansemw_burned = 0;
    position.absorbed_count = 0;
    position.absorbed_tiers = [0; MAX_ABSORBED as usize];
    position.vault_balance = 0;
    position.lifetime_earned = 0;
    position.stake_bonus_pct = 0;
    position.bump = ctx.bumps.position;
    position.reserved = [0u8; 64];

    Ok(())
}
