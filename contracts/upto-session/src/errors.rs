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
    }
}
