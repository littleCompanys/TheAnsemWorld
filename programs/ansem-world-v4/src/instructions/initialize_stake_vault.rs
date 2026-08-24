use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::state::{GlobalConfig, STAKE_VAULT_SEED};

/// Creates the program-owned token account that holds locked $ANSEMW.
///
/// Separate from initialize_protocol for the same reason the fuse feed
/// is: that instruction already sits near Solana's 4KB stack limit, and
/// one more init account tips it over. Permissionless - it holds staked
/// tokens for their owners and has no privileged control.
#[derive(Accounts)]
pub struct InitializeStakeVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [GlobalConfig::SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        constraint = ansemw_mint.key() == config.ansemw_mint
    )]
    pub ansemw_mint: InterfaceAccount<'info, Mint>,

    /// The vault. Its own authority, so only the program signs unlocks.
    #[account(
        init,
        payer = payer,
        seeds = [STAKE_VAULT_SEED],
        bump,
        token::mint = ansemw_mint,
        token::authority = stake_vault,
    )]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(_ctx: Context<InitializeStakeVault>) -> Result<()> {
    Ok(())
}
