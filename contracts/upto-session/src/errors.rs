use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
    ExpiredSession = 4,
    SessionNotFound = 5,
    SessionAlreadySettled = 6,
    SessionCancelled = 7,
    AmountExceedsCap = 8,
    InvalidAsset = 9,
    InvalidSeller = 10,
    TtlExtensionFailed = 11,
    InvalidResourceHash = 12,
    InvalidUsageHash = 13,
    UnsupportedAsset = 14,
    InvalidSupportedAssets = 15,
    SessionDurationTooLong = 16,
    LiabilityOverflow = 17,
    LiabilityUnderflow = 18,
    EscrowUnderfunded = 19,
    NotInitialized = 20,
    SessionExpired = 21,
    SessionNotExpired = 22,
    InvalidAssetCap = 23,
    AssetCapNotConfigured = 24,
    InvalidAdmin = 25,
    InvalidAdminRotationExpiry = 26,
    AdminRotationPending = 27,
    AdminRotationNotFound = 28,
    AdminRotationExpired = 29,
    TokenInvariantViolation = 30,
    InvalidBatchSize = 31,
    InvalidAssetInterface = 32,
    AssetNotActive = 33,
    AssetNotDeprecated = 34,
    AssetLiabilityOutstanding = 35,
    SessionRejected = 36,
    CapIncreasePending = 36,
    CapIncreaseNotReady = 37,
    CapIncreaseNotFound = 38,
    CapIncreaseExpired = 39,
    InvalidCapIncreaseDelay = 40,
    UnsupportedCommitmentScheme = 41,
    SellerExposureCeilingExceeded = 36,
    SellerExposureCeilingNotConfigured = 37,
    BuyerOpenSessionsExceeded = 38,
    InvalidSessionCountLimit = 39,
    SellerOpenSessionsExceeded = 40,
    InvalidCapReduction = 41,
    CapIncreasePending = 38,
    CapIncreaseNotReady = 39,
    CapIncreaseNotFound = 40,
    CapIncreaseExpired = 41,
    InvalidCapIncreaseDelay = 42,
    UnsupportedCommitmentScheme = 43,
    SellerExposureCeilingExceeded = 44,
    SellerExposureCeilingNotConfigured = 45,
    BuyerOpenSessionsExceeded = 46,
    InvalidSessionCountLimit = 47,
    SellerOpenSessionsExceeded = 48,
    InvalidCapReduction = 49,
    CreationPaused = 36,
    OperationalStateUnchanged = 37,
    AssetAlreadyActive = 36,
    AssetDeprecated = 37,
    AssetLimitReached = 38,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(ContractError::AlreadyInitialized as u32, 1);
        assert_eq!(ContractError::Unauthorized as u32, 2);
        assert_eq!(ContractError::InvalidAmount as u32, 3);
        assert_eq!(ContractError::ExpiredSession as u32, 4);
        assert_eq!(ContractError::SessionNotFound as u32, 5);
        assert_eq!(ContractError::SessionAlreadySettled as u32, 6);
        assert_eq!(ContractError::SessionCancelled as u32, 7);
        assert_eq!(ContractError::AmountExceedsCap as u32, 8);
        assert_eq!(ContractError::InvalidAsset as u32, 9);
        assert_eq!(ContractError::InvalidSeller as u32, 10);
        assert_eq!(ContractError::TtlExtensionFailed as u32, 11);
        assert_eq!(ContractError::InvalidResourceHash as u32, 12);
        assert_eq!(ContractError::InvalidUsageHash as u32, 13);
        assert_eq!(ContractError::UnsupportedAsset as u32, 14);
        assert_eq!(ContractError::InvalidSupportedAssets as u32, 15);
        assert_eq!(ContractError::SessionDurationTooLong as u32, 16);
        assert_eq!(ContractError::LiabilityOverflow as u32, 17);
        assert_eq!(ContractError::LiabilityUnderflow as u32, 18);
        assert_eq!(ContractError::EscrowUnderfunded as u32, 19);
        assert_eq!(ContractError::NotInitialized as u32, 20);
        assert_eq!(ContractError::SessionExpired as u32, 21);
        assert_eq!(ContractError::SessionNotExpired as u32, 22);
        assert_eq!(ContractError::InvalidAssetCap as u32, 23);
        assert_eq!(ContractError::AssetCapNotConfigured as u32, 24);
        assert_eq!(ContractError::InvalidAdmin as u32, 25);
        assert_eq!(ContractError::InvalidAdminRotationExpiry as u32, 26);
        assert_eq!(ContractError::AdminRotationPending as u32, 27);
        assert_eq!(ContractError::AdminRotationNotFound as u32, 28);
        assert_eq!(ContractError::AdminRotationExpired as u32, 29);
        assert_eq!(ContractError::TokenInvariantViolation as u32, 30);
        assert_eq!(ContractError::InvalidBatchSize as u32, 31);
        assert_eq!(ContractError::InvalidAssetInterface as u32, 32);
        assert_eq!(ContractError::AssetNotActive as u32, 33);
        assert_eq!(ContractError::AssetNotDeprecated as u32, 34);
        assert_eq!(ContractError::AssetLiabilityOutstanding as u32, 35);
        assert_eq!(ContractError::SessionRejected as u32, 36);
        assert_eq!(ContractError::CapIncreasePending as u32, 36);
        assert_eq!(ContractError::CapIncreaseNotReady as u32, 37);
        assert_eq!(ContractError::CapIncreaseNotFound as u32, 38);
        assert_eq!(ContractError::CapIncreaseExpired as u32, 39);
        assert_eq!(ContractError::InvalidCapIncreaseDelay as u32, 40);
        assert_eq!(ContractError::UnsupportedCommitmentScheme as u32, 41);
        assert_eq!(ContractError::SellerExposureCeilingExceeded as u32, 36);
        assert_eq!(ContractError::SellerExposureCeilingNotConfigured as u32, 37);
        assert_eq!(ContractError::BuyerOpenSessionsExceeded as u32, 38);
        assert_eq!(ContractError::InvalidSessionCountLimit as u32, 39);
        assert_eq!(ContractError::SellerOpenSessionsExceeded as u32, 40);
        assert_eq!(ContractError::InvalidCapReduction as u32, 41);
        assert_eq!(ContractError::CapIncreasePending as u32, 38);
        assert_eq!(ContractError::CapIncreaseNotReady as u32, 39);
        assert_eq!(ContractError::CapIncreaseNotFound as u32, 40);
        assert_eq!(ContractError::CapIncreaseExpired as u32, 41);
        assert_eq!(ContractError::InvalidCapIncreaseDelay as u32, 42);
        assert_eq!(ContractError::UnsupportedCommitmentScheme as u32, 43);
        assert_eq!(ContractError::SellerExposureCeilingExceeded as u32, 44);
        assert_eq!(ContractError::SellerExposureCeilingNotConfigured as u32, 45);
        assert_eq!(ContractError::BuyerOpenSessionsExceeded as u32, 46);
        assert_eq!(ContractError::InvalidSessionCountLimit as u32, 47);
        assert_eq!(ContractError::SellerOpenSessionsExceeded as u32, 48);
        assert_eq!(ContractError::InvalidCapReduction as u32, 49);
        assert_eq!(ContractError::CreationPaused as u32, 36);
        assert_eq!(ContractError::OperationalStateUnchanged as u32, 37);
        assert_eq!(ContractError::AssetAlreadyActive as u32, 36);
        assert_eq!(ContractError::AssetDeprecated as u32, 37);
        assert_eq!(ContractError::AssetLimitReached as u32, 38);
    }
}
