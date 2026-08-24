use anchor_lang::prelude::*;

use crate::{
    errors::AnsemError,
    state::{Position, PRECISION},
};

/// Credits whatever this position has earned since it was last
/// settled into the NFT's own vault, then re-anchors it to the
/// current accumulator.
///
/// The balance lands on the Position, which is keyed by the Core
/// Asset address - so it stays with the NFT through a sale. Only
/// the wallet currently holding the NFT can withdraw it.
pub fn settle_position(position: &mut Position, acc_reward_per_weight: u128) -> Result<()> {
    // An inactive position earns nothing, but we still re-anchor it
    // so it cannot later claim the gap it sat out.
    if !position.active {
        position.reward_debt = acc_reward_per_weight;
        return Ok(());
    }

    let delta = acc_reward_per_weight
        .checked_sub(position.reward_debt)
        .ok_or(AnsemError::MathOverflow)?;

    let earned = (position.effective_weight as u128)
        .checked_mul(delta)
        .ok_or(AnsemError::MathOverflow)?
        .checked_div(PRECISION)
        .ok_or(AnsemError::MathOverflow)? as u64;

    if earned > 0 {
        position.vault_balance = position
            .vault_balance
            .checked_add(earned)
            .ok_or(AnsemError::MathOverflow)?;
        position.lifetime_earned = position
            .lifetime_earned
            .checked_add(earned)
            .ok_or(AnsemError::MathOverflow)?;
    }

    position.reward_debt = acc_reward_per_weight;

    Ok(())
}

/// Config-stored costs (activation_cost, tier_thresholds, fuse_costs) are
/// whole $ANSEMW counts, not atomic units - that's what every other part
/// of the program and the frontend already treats them as (position
/// tracking, upgrade/fuse cost math, the UI's "25,000 $ANSEMW" labels).
/// The SPL Token program has no such notion though: a `burn` amount is
/// always atomic units. Scale by the mint's real decimals right before
/// the CPI, so "25,000" burns 25,000 whole tokens instead of 25,000
/// atomic units (0.025 tokens at 6 decimals).
pub fn to_atomic(whole_amount: u64, decimals: u8) -> Result<u64> {
    let scale = 10u64
        .checked_pow(decimals as u32)
        .ok_or(AnsemError::MathOverflow)?;
    whole_amount
        .checked_mul(scale)
        .ok_or(AnsemError::MathOverflow.into())
}
