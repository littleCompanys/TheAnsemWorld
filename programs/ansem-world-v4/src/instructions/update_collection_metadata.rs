use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use crate::{errors::AnsemError, state::GlobalConfig};

/// Updates the Metaplex Core collection's name and/or URI.
///
/// The collection's update authority was transferred to the GlobalConfig
/// PDA when `claim_collection_authority` ran, so only this program can
/// sign the change. This lets the admin fix metadata (e.g. a placeholder
/// collection URI) after launch without touching individual NFTs.
#[derive(Accounts)]
pub struct UpdateCollectionMetadata<'info> {
    /// Must be the protocol authority.
    #[account(
        mut,
        constraint = authority.key() == config.authority @ AnsemError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [GlobalConfig::SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ AnsemError::Unauthorized
    )]
    pub config: Account<'info, GlobalConfig>,

    /// CHECK: The Core collection pinned to this protocol.
    #[account(
        mut,
        constraint = collection.key() == config.core_collection @ AnsemError::InvalidCollection
    )]
    pub collection: UncheckedAccount<'info>,

    /// CHECK: Core program.
    #[account(address = crate::core_asset::core_program_id())]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<UpdateCollectionMetadata>,
    new_name: Option<String>,
    new_uri: Option<String>,
) -> Result<()> {
    require!(
        ctx.accounts.config.collection_claimed,
        AnsemError::Unauthorized
    );

    let core_id = crate::core_asset::core_program_id();
    let config_key = ctx.accounts.config.key();
    let authority_key = ctx.accounts.authority.key();

    // UpdateCollectionV1 — discriminator 16
    // Accounts:
    //   0. collection              (mut)
    //   1. payer                   (mut, signer)       ← authority
    //   2. authority               (signer, optional)  ← config PDA
    //   3. new_update_authority    (optional)          ← None
    //   4. system_program
    //   5. log_wrapper             (optional)
    //
    // Args (borsh):
    //   discriminator: u8 = 16
    //   new_name:  Option<String>
    //   new_uri:   Option<String>
    let mut data = vec![16u8]; // discriminator

    // Option<String> borsh: 0u8 = None, 1u8 + u32 LE len + bytes = Some
    match &new_name {
        None => data.push(0u8),
        Some(s) => {
            data.push(1u8);
            let b = s.as_bytes();
            data.extend_from_slice(&(b.len() as u32).to_le_bytes());
            data.extend_from_slice(b);
        }
    }
    match &new_uri {
        None => data.push(0u8),
        Some(s) => {
            data.push(1u8);
            let b = s.as_bytes();
            data.extend_from_slice(&(b.len() as u32).to_le_bytes());
            data.extend_from_slice(b);
        }
    }

    let accounts_meta = vec![
        AccountMeta::new(ctx.accounts.collection.key(), false),
        AccountMeta::new(authority_key, true),        // payer
        AccountMeta::new_readonly(config_key, true),  // current authority = config PDA
        AccountMeta::new_readonly(core_id, false),    // new_update_authority = None (placeholder)
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        AccountMeta::new_readonly(core_id, false),    // log_wrapper = None
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
            ctx.accounts.collection.to_account_info(),
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.config.to_account_info(),
            ctx.accounts.mpl_core_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[config_seeds],
    )?;

    Ok(())
}
