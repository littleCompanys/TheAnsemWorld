use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    system_instruction,
};

use crate::{
    errors::AnsemError,
    state::{GlobalConfig, Position, RewardState, PIECE_NAME_PREFIX},
};

/// Mints one World Piece NFT into the caller's wallet and
/// simultaneously creates the Position PDA for it.
///
/// Prerequisites:
///   - claim_collection_authority has run (config.collection_claimed)
///   - The buyer holds enough SOL for mint_price + account rent
///
/// The config PDA is the collection's update authority (set by
/// claim_collection_authority), so it can sign the Core CPI without
/// any external keypair. This means the team cannot bypass the mint
/// price — every NFT must go through this instruction.
///
/// The metadata is NOT an argument. Name and URI are derived from
/// `config.base_uri` and the piece's mint index, so a buyer receives
/// whatever the counter was standing at when their transaction landed.
///
/// This matters because the instruction is permissionless and always
/// will be: anyone can build the transaction from the program id and
/// the instruction name, with or without the published IDL. When the
/// URI was a parameter, the first buyer who read the frontend's asset
/// list could simply ask for the rarest piece - no exploit needed, and
/// no way to undo it afterwards, since nothing in this program can
/// rewrite an asset's metadata once Core has written it.
///
/// Deriving it also makes the mint order auditable: piece N is
/// `{base_uri}N.json`, and the chain records who got which index.
#[derive(Accounts)]
pub struct MintNft<'info> {
    /// The buyer — pays mint_price SOL + Position rent.
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Fresh keypair generated client-side for this NFT.
    /// Must be a signer because Core uses the asset account's pubkey
    /// as the NFT's permanent address.
    /// CHECK: Core will initialise this account — we must NOT pre-init it.
    #[account(mut)]
    pub asset: Signer<'info>,

    #[account(
        mut,
        seeds = [GlobalConfig::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [RewardState::SEED],
        bump = reward_state.bump
    )]
    pub reward_state: Account<'info, RewardState>,

    /// CHECK: The collection this NFT joins. Pinned to config.
    #[account(
        mut,
        constraint = collection.key() == config.core_collection @ AnsemError::InvalidCollection
    )]
    pub collection: UncheckedAccount<'info>,

    /// Receives mint_price SOL. Pinned so no one can redirect revenue.
    /// CHECK: Verified via constraint only — it is a plain SOL account.
    #[account(
        mut,
        constraint = treasury.key() == config.treasury @ AnsemError::Unauthorized
    )]
    pub treasury: UncheckedAccount<'info>,

    /// Position PDA for the new NFT. Created here so the buyer only
    /// needs one transaction to go from nothing to a registered piece.
    #[account(
        init,
        payer = buyer,
        space = 8 + Position::INIT_SPACE,
        seeds = [Position::SEED, asset.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    /// CHECK: Core program.
    #[account(address = crate::core_asset::core_program_id())]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MintNft>) -> Result<()> {
    require!(!ctx.accounts.config.paused, AnsemError::ProtocolPaused);
    require!(
        ctx.accounts.config.collection_claimed,
        AnsemError::Unauthorized
    );

    // Supply cap check (0 = unlimited)
    let max = ctx.accounts.config.max_supply;
    if max > 0 {
        require!(
            ctx.accounts.config.current_supply < max,
            AnsemError::MintSupplyExhausted
        );
    }

    // Derive the metadata from the mint counter. `current_supply` is
    // read and incremented inside this one instruction, and the runtime
    // serialises writes to `config`, so two buyers can never land on the
    // same index however they race each other.
    //
    // Numbering is 1-based to match the metadata files already
    // generated (`.../1.json` is piece #1), so base_uri carries its own
    // trailing separator and the two halves simply concatenate.
    let number = ctx
        .accounts
        .config
        .current_supply
        .checked_add(1)
        .ok_or(AnsemError::MathOverflow)?;
    let name = format!("{} #{}", PIECE_NAME_PREFIX, number);
    let uri = format!("{}{}.json", ctx.accounts.config.base_uri, number);

    // ── Collect mint fee ─────────────────────────────────────────────
    let price = ctx.accounts.config.mint_price;
    if price > 0 {
        invoke(
            &system_instruction::transfer(
                &ctx.accounts.buyer.key(),
                &ctx.accounts.treasury.key(),
                price,
            ),
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    }

    // ── Mint via Metaplex Core CreateV1 ─────────────────────────────
    //
    // Encoded by hand (same approach as BurnV1 in fuse.rs) to avoid
    // the solana_address::Address vs Pubkey type mismatch that comes
    // with enabling mpl-core's "anchor" feature.
    //
    // CreateV1 accounts (from mpl-core generated code):
    //   0. asset                   (mut, signer)
    //   1. collection              (mut, optional)
    //   2. authority               (signer, optional) ← config PDA
    //   3. payer                   (mut, signer)
    //   4. owner                   (optional)         ← buyer
    //   5. update_authority        (optional)         ← None (stays config PDA)
    //   6. system_program
    //   7. log_wrapper             (optional)
    //
    // CreateV1 data (borsh):
    //   [0]      discriminator: u8 = 0
    //   [1]      data_state:    u8 = 0  (AccountState)
    //   [2..6]   name_len:      u32 LE
    //   [6..]    name bytes
    //   [...]    uri_len:       u32 LE
    //   [...]    uri bytes
    //   [...]    plugins:       u8  = 0 (None)

    let mut data = vec![
        0u8, // discriminator: CreateV1
        0u8, // DataState::AccountState
    ];
    // name (borsh String = u32 LE length + utf8 bytes)
    let name_bytes = name.as_bytes();
    data.extend_from_slice(&(name_bytes.len() as u32).to_le_bytes());
    data.extend_from_slice(name_bytes);
    // uri
    let uri_bytes = uri.as_bytes();
    data.extend_from_slice(&(uri_bytes.len() as u32).to_le_bytes());
    data.extend_from_slice(uri_bytes);
    // plugins: None
    data.push(0u8);

    let config_key = ctx.accounts.config.key();
    let buyer_key = ctx.accounts.buyer.key();
    let collection_key = ctx.accounts.collection.key();
    let core_id = crate::core_asset::core_program_id();

    let accounts_meta = vec![
        AccountMeta::new(ctx.accounts.asset.key(), true),
        // collection (Some)
        AccountMeta::new(collection_key, false),
        // authority = config PDA (is the collection update authority)
        AccountMeta::new_readonly(config_key, true),
        // payer = buyer
        AccountMeta::new(buyer_key, true),
        // owner = buyer (Some)
        AccountMeta::new_readonly(buyer_key, false),
        // update_authority = None (program id placeholder)
        AccountMeta::new_readonly(core_id, false),
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        // log_wrapper = None
        AccountMeta::new_readonly(core_id, false),
    ];

    let ix = Instruction {
        program_id: core_id,
        accounts: accounts_meta,
        data,
    };

    let config_seeds: &[&[u8]] = &[GlobalConfig::SEED, &[ctx.accounts.config.bump]];

    invoke_signed(
        &ix,
        &[
            ctx.accounts.asset.to_account_info(),
            ctx.accounts.collection.to_account_info(),
            ctx.accounts.config.to_account_info(), // authority (PDA signer)
            ctx.accounts.buyer.to_account_info(),  // payer
            ctx.accounts.buyer.to_account_info(),  // owner
            ctx.accounts.mpl_core_program.to_account_info(), // update_authority None
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.mpl_core_program.to_account_info(), // log_wrapper None
        ],
        &[config_seeds],
    )?;

    // ── Initialize Position PDA ──────────────────────────────────────
    // Same logic as initialize_position.rs but inlined so the buyer
    // needs only one transaction.
    let reward_state = &ctx.accounts.reward_state;
    let position = &mut ctx.accounts.position;
    position.asset = ctx.accounts.asset.key();
    position.activation_owner = Pubkey::default();
    position.active = false;
    position.tier = 1;
    position.base_weight = ctx
        .accounts
        .config
        .weight_for_tier(1)
        .ok_or(AnsemError::InvalidTier)?;
    position.effective_weight = position.base_weight;
    // Anchor at current acc so this position cannot claim rewards
    // that accrued before it was minted.
    position.reward_debt = reward_state.acc_reward_per_weight;
    position.cumulative_ansemw_burned = 0;
    position.absorbed_count = 0;
    position.absorbed_tiers = [0u8; 2];
    position.vault_balance = 0;
    position.lifetime_earned = 0;
    position.stake_bonus_pct = 0;
    position.bump = ctx.bumps.position;
    position.reserved = [0u8; 64];

    // ── Update supply counter ────────────────────────────────────────
    ctx.accounts.config.current_supply = ctx
        .accounts
        .config
        .current_supply
        .checked_add(1)
        .ok_or(AnsemError::MathOverflow)?;

    Ok(())
}
