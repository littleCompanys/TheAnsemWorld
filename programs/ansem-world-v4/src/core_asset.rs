use anchor_lang::prelude::*;
use mpl_core::{accounts::BaseAssetV1, types::UpdateAuthority};

use crate::errors::AnsemError;

/// mpl-core is built against a newer solana-program than Anchor is,
/// so its addresses are `solana_address::Address` while ours are
/// `Pubkey`. Both are the same 32 bytes; this is the one place that
/// crossing happens, kept explicit rather than scattered around.
macro_rules! same_key {
    ($a:expr, $b:expr) => {
        $a.to_bytes() == $b.to_bytes()
    };
}

/// The Core program id, as an Anchor `Pubkey`. mpl-core exposes it
/// in its own address type, so the crossing happens once here.
pub fn core_program_id() -> Pubkey {
    Pubkey::new_from_array(mpl_core::ID.to_bytes())
}

/// Reads a Metaplex Core Asset straight from chain state.
///
/// The order of checks matters. Deserializing first would be
/// meaningless: anyone can create an account holding bytes that
/// look like a Core Asset. Only after confirming the Core program
/// owns the account do its contents mean anything, because only
/// that program can write them.
fn load_asset(asset_info: &AccountInfo) -> Result<BaseAssetV1> {
    require!(
        same_key!(asset_info.owner, mpl_core::ID),
        AnsemError::NotACoreAsset
    );

    let data = asset_info.try_borrow_data()?;
    BaseAssetV1::from_bytes(&data).map_err(|_| error!(AnsemError::MalformedCoreAsset))
}

/// The wallet that currently holds this NFT, as Core itself
/// records it. This is the only source of truth we accept - never
/// a value supplied by the caller or an off-chain index.
pub fn current_owner(asset_info: &AccountInfo) -> Result<Pubkey> {
    Ok(Pubkey::new_from_array(
        load_asset(asset_info)?.owner.to_bytes(),
    ))
}

/// Confirms the asset is part of our official collection, without
/// caring who holds it.
pub fn verify_collection(asset_info: &AccountInfo, expected_collection: &Pubkey) -> Result<()> {
    check_collection(&load_asset(asset_info)?, expected_collection)
}

/// Confirms the asset belongs to our official collection AND is
/// currently held by `expected_owner`.
pub fn verify_owner_and_collection(
    asset_info: &AccountInfo,
    expected_owner: &Pubkey,
    expected_collection: &Pubkey,
) -> Result<()> {
    let asset = load_asset(asset_info)?;

    require!(
        same_key!(asset.owner, expected_owner),
        AnsemError::NotAssetOwner
    );

    check_collection(&asset, expected_collection)
}

/// An asset only counts as part of a collection when its update
/// authority IS that collection. An asset carrying a plain address
/// authority belongs to no collection, so it is rejected.
fn check_collection(asset: &BaseAssetV1, expected_collection: &Pubkey) -> Result<()> {
    match asset.update_authority {
        UpdateAuthority::Collection(collection) => {
            require!(
                same_key!(collection, expected_collection),
                AnsemError::InvalidCollection
            );
            Ok(())
        }
        _ => err!(AnsemError::InvalidCollection),
    }
}
