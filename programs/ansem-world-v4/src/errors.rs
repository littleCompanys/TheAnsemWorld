use anchor_lang::prelude::*;

#[error_code]
pub enum AnsemError {
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("NFT position is already active")]
    AlreadyActive,
    #[msg("NFT position is not active")]
    NotActive,
    #[msg("Signer is not the current NFT owner")]
    NotAssetOwner,
    #[msg("The supplied Core asset does not belong to this collection")]
    InvalidCollection,
    #[msg("The supplied token mint is invalid")]
    InvalidMint,
    #[msg("Position activation owner does not match")]
    ActivationOwnerMismatch,
    #[msg("Nothing available to claim")]
    NothingToClaim,
    #[msg("Reward pool has insufficient ANSEM")]
    InsufficientRewardLiquidity,
    #[msg("No active weight exists")]
    NoActiveWeight,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Only the protocol authority can perform this action")]
    Unauthorized,
    #[msg("Account is not owned by the Metaplex Core program")]
    NotACoreAsset,
    #[msg("Core asset could not be deserialized")]
    MalformedCoreAsset,
    #[msg("Tier thresholds and weights must both increase")]
    InvalidTierTable,
    #[msg("Target tier must be higher than the current tier")]
    NotAnUpgrade,
    #[msg("Target tier does not exist")]
    InvalidTier,
    #[msg("An NFT cannot be fused with itself")]
    CannotFuseWithSelf,
    #[msg("This NFT has already absorbed the maximum number of others")]
    FuseLimitReached,
    #[msg("This NFT has no absorbed part at that index")]
    NoSuchPart,
    #[msg("Mint supply cap has been reached")]
    MintSupplyExhausted,
    #[msg("NFT name or URI is empty or too long")]
    InvalidMintMetadata,
    #[msg("Stake amount must be greater than zero")]
    InvalidStakeAmount,
    #[msg("This wallet has no stake")]
    NotStaked,
    #[msg("The focused piece does not match this stake")]
    StakeFocusMismatch,
    #[msg("The piece must be active and activated by you to focus a stake on it")]
    StakeTargetNotYours,
    #[msg("Unstake or unfocus before fusing a piece that carries a stake bonus")]
    StakeBonusOnFuse,
    #[msg("Base URI is empty or too long")]
    InvalidBaseUri,
    #[msg("The base URI is frozen once the first piece has been minted")]
    BaseUriLocked,
    #[msg("Activation cost is above the hard ceiling")]
    ActivationCostTooHigh,
    #[msg("This asset still exists - nothing to reap")]
    AssetStillExists,
}
