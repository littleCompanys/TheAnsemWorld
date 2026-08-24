use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    errors::AnsemError,
    state::{GlobalConfig, RewardState, REWARD_VAULT_SEED, PRECISION},
};

#[derive(Accounts)]
pub struct FundRewards<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
        seeds = [GlobalConfig::SEED],
        bump = config.bump,
        has_one = ansem_mint @ AnsemError::InvalidMint
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [RewardState::SEED],
        bump = reward_state.bump
    )]
    pub reward_state: Account<'info, RewardState>,

    /// Needed by transfer_checked (which Token-2022 requires in place
    /// of the bare transfer). Pinned to the configured mint by the
    /// has_one on `config` above, which also lets Anchor's client
    /// resolve it automatically.
    pub ansem_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = funder_ansem.owner == funder.key() @ AnsemError::NotAssetOwner,
        constraint = funder_ansem.mint == config.ansem_mint @ AnsemError::InvalidMint
    )]
    pub funder_ansem: InterfaceAccount<'info, TokenAccount>,

    /// Pinned to the canonical vault PDA, so rewards can never be
    /// credited against tokens sitting in some other account.
    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED],
        bump = config.reward_vault_bump
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, AnsemError::ProtocolPaused);
    require!(amount > 0, AnsemError::NothingToClaim);
    // With no active weight there is nobody to divide among, and the
    // division below would be by zero.
    require!(
        ctx.accounts.reward_state.total_weight > 0,
        AnsemError::NoActiveWeight
    );

    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.funder_ansem.to_account_info(),
                mint: ctx.accounts.ansem_mint.to_account_info(),
                to: ctx.accounts.reward_vault.to_account_info(),
                authority: ctx.accounts.funder.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.ansem_mint.decimals,
    )?;

    let reward_state = &mut ctx.accounts.reward_state;

    // Scale up before dividing so integer division doesn't wipe out
    // small per-weight amounts.
    let delta = (amount as u128)
        .checked_mul(PRECISION)
        .ok_or(AnsemError::MathOverflow)?
        .checked_div(reward_state.total_weight as u128)
        .ok_or(AnsemError::MathOverflow)?;

    reward_state.acc_reward_per_weight = reward_state
        .acc_reward_per_weight
        .checked_add(delta)
        .ok_or(AnsemError::MathOverflow)?;

    reward_state.total_allocated = reward_state
        .total_allocated
        .checked_add(amount)
        .ok_or(AnsemError::MathOverflow)?;

    Ok(())
}
