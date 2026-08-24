use anchor_lang::prelude::*;

use crate::{
    errors::AnsemError,
    state::{GlobalConfig, Treasury},
};

/// Moves collected revenue out to be converted into $ANSEM.
///
/// The destination is pinned to `config.treasury`, fixed when the
/// protocol was initialized. The authority chooses when and how
/// much, never where - so a compromised authority key cannot
/// redirect revenue to an arbitrary wallet.
///
/// What happens next is off-chain: the keeper swaps the SOL for
/// $ANSEM on Jupiter and calls fund_rewards. That step is
/// deliberately outside this program, and nothing about the swap
/// result feeds back into what holders are owed.
#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [GlobalConfig::SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ AnsemError::Unauthorized
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [Treasury::SEED],
        bump = treasury_vault.bump
    )]
    pub treasury_vault: Account<'info, Treasury>,

    /// CHECK: Pinned to the address recorded at initialization.
    #[account(
        mut,
        constraint = destination.key() == config.treasury @ AnsemError::Unauthorized
    )]
    pub destination: UncheckedAccount<'info>,
}

pub fn withdraw(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
    require!(amount > 0, AnsemError::NothingToClaim);

    let vault_info = ctx.accounts.treasury_vault.to_account_info();

    // The account carries data, so it must stay rent-exempt or the
    // runtime would purge it and the protocol would lose its
    // revenue address.
    let rent_floor = Rent::get()?.minimum_balance(vault_info.data_len());
    let available = vault_info
        .lamports()
        .checked_sub(rent_floor)
        .ok_or(AnsemError::InsufficientRewardLiquidity)?;
    require!(
        amount <= available,
        AnsemError::InsufficientRewardLiquidity
    );

    // Both accounts are owned by this program's world, so lamports
    // move directly rather than through a System transfer CPI.
    **vault_info.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.destination.try_borrow_mut_lamports()? += amount;

    let treasury = &mut ctx.accounts.treasury_vault;
    treasury.total_withdrawn = treasury
        .total_withdrawn
        .checked_add(amount)
        .ok_or(AnsemError::MathOverflow)?;

    Ok(())
}
