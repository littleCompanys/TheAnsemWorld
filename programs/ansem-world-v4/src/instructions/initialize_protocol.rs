use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::AnsemError,
    state::{GlobalConfig, RewardState, Treasury, MAX_ABSORBED, REWARD_VAULT_SEED, TIER_COUNT},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeProtocolArgs {
    pub core_collection: Pubkey,
    pub treasury: Pubkey,
    pub activation_cost: u64,
    pub tier_thresholds: [u64; TIER_COUNT],
    pub tier_weights: [u64; TIER_COUNT],
    pub fuse_costs: [u64; MAX_ABSORBED as usize],
    /// SOL price (lamports) per mint. Can be updated later.
    pub mint_price: u64,
    /// Hard supply cap. 0 = unlimited.
    pub max_supply: u32,
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    /// Whoever calls this becomes the protocol authority. Can only
    /// succeed once - the PDAs below already existing makes a second
    /// call fail.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [GlobalConfig::SEED],
        bump
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + RewardState::INIT_SPACE,
        seeds = [RewardState::SEED],
        bump
    )]
    pub reward_state: Account<'info, RewardState>,

    /// Passed as a real Mint account (not just a pubkey) so the
    /// runtime proves it actually is a mint before we record it.
    pub ansem_mint: InterfaceAccount<'info, Mint>,
    pub ansemw_mint: InterfaceAccount<'info, Mint>,

    /// The single global $ANSEM reward vault. It is its own
    /// authority, so only this program can move funds out of it.
    #[account(
        init,
        payer = authority,
        seeds = [REWARD_VAULT_SEED],
        bump,
        token::mint = ansem_mint,
        token::authority = reward_vault,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    /// Collects royalties and trading fees in SOL.
    #[account(
        init,
        payer = authority,
        space = 8 + Treasury::INIT_SPACE,
        seeds = [Treasury::SEED],
        bump
    )]
    pub treasury_vault: Account<'info, Treasury>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeProtocol>, args: InitializeProtocolArgs) -> Result<()> {
    // Both tables must climb. A flat or descending threshold would
    // make an upgrade free (or underflow the cost), and a flat or
    // descending weight would mean paying for nothing.
    for i in 1..TIER_COUNT {
        require!(
            args.tier_thresholds[i] > args.tier_thresholds[i - 1],
            AnsemError::InvalidTierTable
        );
        require!(
            args.tier_weights[i] > args.tier_weights[i - 1],
            AnsemError::InvalidTierTable
        );
    }
    require!(args.tier_weights[0] > 0, AnsemError::InvalidTierTable);
    for cost in args.fuse_costs.iter() {
        require!(*cost > 0, AnsemError::InvalidTierTable);
    }

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.tier_thresholds = args.tier_thresholds;
    config.tier_weights = args.tier_weights;
    config.fuse_costs = args.fuse_costs;
    config.ansem_mint = ctx.accounts.ansem_mint.key();
    config.ansemw_mint = ctx.accounts.ansemw_mint.key();
    config.core_collection = args.core_collection;
    config.treasury = args.treasury;
    config.activation_cost = args.activation_cost;
    config.paused = false;
    config.bump = ctx.bumps.config;
    config.reward_vault_bump = ctx.bumps.reward_vault;
    config.mint_price = args.mint_price;
    config.max_supply = args.max_supply;
    config.current_supply = 0;
    config.collection_claimed = false;

    let reward_state = &mut ctx.accounts.reward_state;
    reward_state.total_weight = 0;
    reward_state.acc_reward_per_weight = 0;
    reward_state.total_allocated = 0;
    reward_state.total_claimed = 0;
    reward_state.bump = ctx.bumps.reward_state;

    let treasury = &mut ctx.accounts.treasury_vault;
    treasury.total_withdrawn = 0;
    treasury.bump = ctx.bumps.treasury_vault;

    Ok(())
}
