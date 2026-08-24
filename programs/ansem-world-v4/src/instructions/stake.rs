use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    errors::AnsemError,
    math,
    state::{
        stake_bonus_for, GlobalConfig, Position, RewardState, StakeAccount,
        STAKE_VAULT_SEED,
    },
};

// ── helpers ────────────────────────────────────────────────────────

/// Moves a stake bonus onto or off a position while keeping the global
/// pool honest. Settle first (credit earnings at the old weight and
/// re-anchor reward_debt, which is what stops a stake made mid-round
/// from harvesting that round). Then swap the weight in and out of
/// total_weight only while the piece is active.
fn set_bonus_on_position(
    position: &mut Position,
    reward_state: &mut RewardState,
    config: &GlobalConfig,
    new_bonus: u8,
) -> Result<()> {
    math::settle_position(position, reward_state.acc_reward_per_weight)?;

    if position.active {
        reward_state.total_weight = reward_state
            .total_weight
            .checked_sub(position.effective_weight)
            .ok_or(AnsemError::MathOverflow)?;
    }

    position.stake_bonus_pct = new_bonus;
    position
        .refresh_weights(config)
        .ok_or(AnsemError::MathOverflow)?;

    if position.active {
        reward_state.total_weight = reward_state
            .total_weight
            .checked_add(position.effective_weight)
            .ok_or(AnsemError::MathOverflow)?;
    }
    Ok(())
}

// ── stake ──────────────────────────────────────────────────────────

/// Locks $ANSEMW against one piece, raising that piece's earning bonus.
///
/// One lock per (wallet, piece): a wallet can stake several pieces at
/// once, and each piece's tier is derived from its own lock alone. Call
/// again on the same piece to top up - the amount adds, the tier is
/// recomputed, and settling the piece resets the timing so the larger
/// bonus only applies from the next accrual (at most one round lost on
/// the amount added, never a way to game a round already in flight).
///
/// The piece must be active and activated by the caller. A stake on a
/// piece earning nothing would earn nothing, so the program refuses to
/// create that dead state.
#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        seeds = [GlobalConfig::SEED],
        bump = config.bump,
        has_one = ansemw_mint @ AnsemError::InvalidMint
    )]
    pub config: Box<Account<'info, GlobalConfig>>,

    #[account(mut, seeds = [RewardState::SEED], bump = reward_state.bump)]
    pub reward_state: Box<Account<'info, RewardState>>,

    #[account(
        init_if_needed,
        payer = staker,
        space = 8 + StakeAccount::INIT_SPACE,
        seeds = [StakeAccount::SEED, staker.key().as_ref(), asset.key().as_ref()],
        bump
    )]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    #[account(mut, seeds = [STAKE_VAULT_SEED], bump)]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = staker_ansemw.owner == staker.key() @ AnsemError::StakeTargetNotYours,
        constraint = staker_ansemw.mint == config.ansemw_mint @ AnsemError::InvalidMint
    )]
    pub staker_ansemw: Box<InterfaceAccount<'info, TokenAccount>>,

    pub ansemw_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: the NFT to boost; only its key is used, and it is bound to
    /// the position PDA below.
    pub asset: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [Position::SEED, asset.key().as_ref()],
        bump = position.bump,
        constraint = position.asset == asset.key() @ AnsemError::StakeTargetNotYours
    )]
    pub position: Box<Account<'info, Position>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(amount > 0, AnsemError::InvalidStakeAmount);

    // The piece must be earning right now and belong to the staker.
    require!(
        ctx.accounts.position.active
            && ctx.accounts.position.activation_owner == ctx.accounts.staker.key(),
        AnsemError::StakeTargetNotYours
    );

    let stake_account = &mut ctx.accounts.stake_account;
    // Fresh account: Anchor zeroed it, so owner reads as default.
    if stake_account.owner == Pubkey::default() {
        stake_account.owner = ctx.accounts.staker.key();
        stake_account.asset = ctx.accounts.asset.key();
        stake_account.amount = 0;
        stake_account.bump = ctx.bumps.stake_account;
    }
    require!(
        stake_account.owner == ctx.accounts.staker.key()
            && stake_account.asset == ctx.accounts.asset.key(),
        AnsemError::StakeTargetNotYours
    );

    // Pull the tokens in.
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.staker_ansemw.to_account_info(),
                mint: ctx.accounts.ansemw_mint.to_account_info(),
                to: ctx.accounts.stake_vault.to_account_info(),
                authority: ctx.accounts.staker.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.ansemw_mint.decimals,
    )?;

    stake_account.amount = stake_account
        .amount
        .checked_add(amount)
        .ok_or(AnsemError::MathOverflow)?;

    let new_bonus = stake_bonus_for(stake_account.amount);
    let config = (*ctx.accounts.config).clone();
    set_bonus_on_position(
        &mut ctx.accounts.position,
        &mut ctx.accounts.reward_state,
        &config,
        new_bonus,
    )?;

    Ok(())
}

// ── unstake ────────────────────────────────────────────────────────

/// Returns the $ANSEMW locked against one piece and clears its bonus.
/// No fee, no cooldown. Other pieces this wallet staked are untouched.
///
/// If the piece was sold, this wallet is no longer its activation owner
/// and any bonus on it belongs to whoever holds it now, so only the
/// tokens come back and the piece is left alone.
#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        seeds = [GlobalConfig::SEED],
        bump = config.bump,
        has_one = ansemw_mint @ AnsemError::InvalidMint
    )]
    pub config: Box<Account<'info, GlobalConfig>>,

    #[account(mut, seeds = [RewardState::SEED], bump = reward_state.bump)]
    pub reward_state: Box<Account<'info, RewardState>>,

    #[account(
        mut,
        seeds = [StakeAccount::SEED, staker.key().as_ref(), asset.key().as_ref()],
        bump = stake_account.bump,
        has_one = owner @ AnsemError::StakeTargetNotYours,
        constraint = stake_account.asset == asset.key() @ AnsemError::StakeTargetNotYours,
        close = staker
    )]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    /// CHECK: used only to prove the owner field matches the signer.
    #[account(address = staker.key())]
    pub owner: UncheckedAccount<'info>,

    #[account(mut, seeds = [STAKE_VAULT_SEED], bump)]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = staker_ansemw.owner == staker.key() @ AnsemError::StakeTargetNotYours,
        constraint = staker_ansemw.mint == config.ansemw_mint @ AnsemError::InvalidMint
    )]
    pub staker_ansemw: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Needed by transfer_checked (which Token-2022 requires in place
    /// of the bare transfer). Pinned by the has_one on `config`.
    pub ansemw_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: bound to the position PDA below.
    pub asset: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [Position::SEED, asset.key().as_ref()],
        bump = position.bump,
        constraint = position.asset == asset.key() @ AnsemError::StakeTargetNotYours
    )]
    pub position: Box<Account<'info, Position>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
    require!(ctx.accounts.stake_account.amount > 0, AnsemError::NotStaked);

    // Strip the bonus from the piece before the tokens leave - but only
    // if this wallet's stake is what the piece is actually carrying.
    //
    // After a sale the piece can already be activated and staked by its
    // new holder, while the seller's StakeAccount lives on untouched.
    // Zeroing unconditionally would let that seller wipe the buyer's
    // bonus by withdrawing their own tokens. `stake` only ever writes a
    // bonus for the activation owner, so that field is the reliable
    // answer to "whose stake is on this piece right now".
    //
    // When it is not this wallet's, there is nothing to un-apply and no
    // weight changes, so the settle is skipped along with it.
    if ctx.accounts.position.activation_owner == ctx.accounts.staker.key() {
        let config = (*ctx.accounts.config).clone();
        set_bonus_on_position(
            &mut ctx.accounts.position,
            &mut ctx.accounts.reward_state,
            &config,
            0,
        )?;
    }

    // Unlock everything for this piece.
    let amount = ctx.accounts.stake_account.amount;
    let bump = ctx.bumps.stake_vault;
    let signer: &[&[&[u8]]] = &[&[STAKE_VAULT_SEED, &[bump]]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.stake_vault.to_account_info(),
                mint: ctx.accounts.ansemw_mint.to_account_info(),
                to: ctx.accounts.staker_ansemw.to_account_info(),
                authority: ctx.accounts.stake_vault.to_account_info(),
            },
            signer,
        ),
        amount,
        ctx.accounts.ansemw_mint.decimals,
    )?;
    // stake_account is closed by the `close = staker` constraint.
    Ok(())
}
