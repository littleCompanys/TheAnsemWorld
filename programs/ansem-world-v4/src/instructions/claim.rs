use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    core_asset,
    errors::AnsemError,
    math,
    state::{GlobalConfig, Position, RewardState, REWARD_VAULT_SEED},
};

/// Every account is boxed. The state structs carry reserved padding
/// for future fields, and deserialising them onto Solana's 4KB stack
/// overflows it - the same constraint fuse() hit first. Boxing moves
/// them to the heap; without it the failure is a runtime access
/// violation, not a compile error.
#[derive(Accounts)]
pub struct Claim<'info> {
    /// Must be the wallet that currently holds the NFT.
    pub owner: Signer<'info>,

    #[account(
        seeds = [GlobalConfig::SEED],
        bump = config.bump,
        has_one = ansem_mint @ AnsemError::InvalidMint
    )]
    pub config: Box<Account<'info, GlobalConfig>>,

    /// CHECK: Validated in the handler. Because the vault belongs
    /// to the NFT, this check is what stands between a stranger and
    /// someone else's balance - it reads the holder from Core's own
    /// state, never from anything the caller supplies.
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
        seeds = [RewardState::SEED],
        bump = reward_state.bump
    )]
    pub reward_state: Box<Account<'info, RewardState>>,

    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED],
        bump = config.reward_vault_bump
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Needed by transfer_checked (which Token-2022 requires in place
    /// of the bare transfer). Pinned to the configured mint by the
    /// has_one on `config` above, which also lets Anchor's client
    /// resolve it automatically.
    pub ansem_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Funds can only ever move to the caller's own account.
    #[account(
        mut,
        constraint = owner_ansem.owner == owner.key() @ AnsemError::NotAssetOwner,
        constraint = owner_ansem.mint == config.ansem_mint @ AnsemError::InvalidMint
    )]
    pub owner_ansem: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Claim>) -> Result<()> {
    require!(!ctx.accounts.config.paused, AnsemError::ProtocolPaused);

    // Only the wallet Core currently records as the holder may
    // withdraw, and the constraint above forces the destination to
    // be that same wallet's account.
    core_asset::verify_owner_and_collection(
        &ctx.accounts.asset.to_account_info(),
        &ctx.accounts.owner.key(),
        &ctx.accounts.config.core_collection,
    )?;

    // Sweep in anything earned up to this instant first, so the
    // holder never has to settle separately before claiming.
    math::settle_position(
        &mut ctx.accounts.position,
        ctx.accounts.reward_state.acc_reward_per_weight,
    )?;

    let amount = ctx.accounts.position.vault_balance;
    require!(amount > 0, AnsemError::NothingToClaim);
    require!(
        ctx.accounts.reward_vault.amount >= amount,
        AnsemError::InsufficientRewardLiquidity
    );

    // The vault is its own authority, so the program signs for it
    // using the canonical bump recorded at initialization.
    let bump = ctx.accounts.config.reward_vault_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[REWARD_VAULT_SEED, &[bump]]];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reward_vault.to_account_info(),
                mint: ctx.accounts.ansem_mint.to_account_info(),
                to: ctx.accounts.owner_ansem.to_account_info(),
                authority: ctx.accounts.reward_vault.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.ansem_mint.decimals,
    )?;

    ctx.accounts.position.vault_balance = 0;

    let reward_state = &mut ctx.accounts.reward_state;
    reward_state.total_claimed = reward_state
        .total_claimed
        .checked_add(amount)
        .ok_or(AnsemError::MathOverflow)?;

    Ok(())
}
