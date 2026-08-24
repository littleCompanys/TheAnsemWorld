use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};

use crate::{errors::AnsemError, state::GlobalConfig};

/// Transfers the Metaplex Core collection's update authority from the
/// deployer keypair to the GlobalConfig PDA.
///
/// This is a one-shot setup call that must be made before mint_nft
/// will work. After it runs, only this program can mint into the
/// collection, because the PDA signature is the only valid
/// collection authority signature.
///
/// Why a separate instruction instead of wiring it into
/// initialize_protocol: the collection may be created before the
/// protocol is initialized, and we do not want to force a specific
/// order. The deployer calls this whenever they are ready to lock
/// the supply under program control.
#[derive(Accounts)]
pub struct ClaimCollectionAuthority<'info> {
    /// Current collection update authority — must sign.
    /// After this instruction it will no longer be the authority.
    #[account(
        mut,
        constraint = authority.key() == config.authority @ AnsemError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [GlobalConfig::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,

    /// CHECK: The Core collection whose authority we are taking over.
    /// Pinned to what was recorded at initialize_protocol.
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

pub fn handler(ctx: Context<ClaimCollectionAuthority>) -> Result<()> {
    require!(
        !ctx.accounts.config.collection_claimed,
        AnsemError::Unauthorized // already claimed
    );

    let config_key = ctx.accounts.config.key();
    let authority_key = ctx.accounts.authority.key();
    let core_id = crate::core_asset::core_program_id();

    // UpdateCollectionV1 — discriminator 16
    // Accounts (from mpl-core generated code):
    //   0. collection              (mut)
    //   1. payer                   (mut, signer)
    //   2. authority               (signer, optional)
    //   3. new_update_authority    (optional)
    //   4. system_program
    //   5. log_wrapper             (optional — program id means none)
    // Args (borsh):
    //   discriminator: u8 = 16
    //   new_name:  Option<String> = None  → 0u8
    //   new_uri:   Option<String> = None  → 0u8
    let accounts_meta = vec![
        AccountMeta::new(ctx.accounts.collection.key(), false),
        AccountMeta::new(authority_key, true),
        AccountMeta::new_readonly(authority_key, true), // current authority
        AccountMeta::new_readonly(config_key, false),   // new_update_authority = config PDA
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        AccountMeta::new_readonly(core_id, false), // no log wrapper
    ];

    let data = vec![16u8, 0u8, 0u8]; // discriminator, no new_name, no new_uri

    let ix = Instruction {
        program_id: core_id,
        accounts: accounts_meta,
        data,
    };

    // Current authority signs as payer/authority. The config PDA is only
    // the *new* update authority and does not need to sign this CPI.
    invoke(
        &ix,
        &[
            ctx.accounts.collection.to_account_info(),
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.config.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.mpl_core_program.to_account_info(),
        ],
    )?;

    ctx.accounts.config.collection_claimed = true;
    Ok(())
}
