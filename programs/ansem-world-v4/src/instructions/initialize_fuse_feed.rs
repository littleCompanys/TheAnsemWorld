use anchor_lang::prelude::*;

use crate::state::{FuseFeed, GlobalConfig};

/// Creates the public fuse feed.
///
/// Deliberately not folded into initialize_protocol: that
/// instruction already deserializes six accounts, and the feed's
/// entry array pushes the combined frame past Solana's 4KB stack
/// limit. Boxed and alone here, it fits.
///
/// Permissionless - the feed holds no funds and its contents are
/// only ever written by fuse(). Whoever calls this just pays rent.
#[derive(Accounts)]
pub struct InitializeFuseFeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Proves the protocol exists before we hang a feed off it.
    #[account(seeds = [GlobalConfig::SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + FuseFeed::INIT_SPACE,
        seeds = [FuseFeed::SEED],
        bump
    )]
    pub fuse_feed: Box<Account<'info, FuseFeed>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeFuseFeed>) -> Result<()> {
    let feed = &mut ctx.accounts.fuse_feed;
    feed.next_index = 0;
    feed.total = 0;
    feed.bump = ctx.bumps.fuse_feed;
    Ok(())
}
