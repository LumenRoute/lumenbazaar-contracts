use crate::{ContractError, Session};
use soroban_sdk::{token, Address, BytesN, Env};

pub const MAX_SESSION_DURATION_LEDGERS: u32 = 518_400;
pub const MIN_ADMIN_ROTATION_DURATION_LEDGERS: u32 = 1;
pub const MAX_ADMIN_ROTATION_DURATION_LEDGERS: u32 = 17_280;
pub const MIN_CAP_INCREASE_DELAY_LEDGERS: u32 = 100;
pub const MAX_CAP_INCREASE_DELAY_LEDGERS: u32 = 17_280;
pub const MAX_TOKEN_DECIMALS: u32 = 38;
pub const MAX_TOKEN_NAME_BYTES: u32 = 64;
pub const MAX_TOKEN_SYMBOL_BYTES: u32 = 12;

pub const SUPPORTED_RESOURCE_SCHEME_VERSION: u32 = 1;
pub const SUPPORTED_USAGE_SCHEME_VERSION: u32 = 1;

pub fn validate_commitment_scheme(
    scheme_version: u32,
    expected_version: u32,
) -> Result<(), ContractError> {
    if scheme_version != expected_version {
        return Err(ContractError::UnsupportedCommitmentScheme);
    }
    Ok(())
}

pub fn validate_cap_increase_proposal(
    env: &Env,
    current_cap: i128,
    proposed_max_amount: i128,
    active_at_ledger: u32,
    expires_at_ledger: u32,
) -> Result<(), ContractError> {
    validate_asset_cap(proposed_max_amount)?;
    if proposed_max_amount <= current_cap {
        return Err(ContractError::InvalidAssetCap);
    }
    let current_ledger = env.ledger().sequence();
    let min_active = match current_ledger.checked_add(MIN_CAP_INCREASE_DELAY_LEDGERS) {
        Some(val) => val,
        None => return Err(ContractError::InvalidCapIncreaseDelay),
    };
    let max_active = match current_ledger.checked_add(MAX_CAP_INCREASE_DELAY_LEDGERS) {
        Some(val) => val,
        None => return Err(ContractError::InvalidCapIncreaseDelay),
    };
    if active_at_ledger < min_active || active_at_ledger > max_active {
        return Err(ContractError::InvalidCapIncreaseDelay);
    }
    if expires_at_ledger <= active_at_ledger {
        return Err(ContractError::InvalidCapIncreaseDelay);
    }
    let max_expiry = match active_at_ledger.checked_add(MAX_CAP_INCREASE_DELAY_LEDGERS) {
        Some(val) => val,
        None => return Err(ContractError::InvalidCapIncreaseDelay),
    };
    if expires_at_ledger > max_expiry {
        return Err(ContractError::InvalidCapIncreaseDelay);
    }
    Ok(())
}

pub fn validate_admin_rotation(
    env: &Env,
    current_admin: &Address,
    pending_admin: &Address,
    expires_at_ledger: u32,
) -> Result<(), ContractError> {
    if current_admin == pending_admin {
        return Err(ContractError::InvalidAdmin);
    }
    let current_ledger = env.ledger().sequence();
    let min_allowed = match current_ledger.checked_add(MIN_ADMIN_ROTATION_DURATION_LEDGERS) {
        Some(val) => val,
        None => return Err(ContractError::InvalidAdminRotationExpiry),
    };
    let max_allowed = match current_ledger.checked_add(MAX_ADMIN_ROTATION_DURATION_LEDGERS) {
        Some(val) => val,
        None => return Err(ContractError::InvalidAdminRotationExpiry),
    };
    if expires_at_ledger < min_allowed || expires_at_ledger > max_allowed {
        return Err(ContractError::InvalidAdminRotationExpiry);
    }
    Ok(())
}

pub fn validate_asset_cap(max_session_amount: i128) -> Result<(), ContractError> {
    if max_session_amount <= 0 {
        return Err(ContractError::InvalidAssetCap);
    }
    Ok(())
}

pub fn validate_asset_policy(
    min_session_amount: i128,
    max_session_amount: i128,
) -> Result<(), ContractError> {
    validate_asset_cap(max_session_amount)?;
    if min_session_amount <= 0 || min_session_amount > max_session_amount {
        return Err(ContractError::InvalidAssetCap);
    }
    Ok(())
}

pub fn validate_exposure_ceiling(ceiling: i128) -> Result<(), ContractError> {
    if ceiling <= 0 {
        return Err(ContractError::InvalidExposureCeiling);
    }
    Ok(())
}

pub struct AssetProbe {
    pub decimals: u32,
}

pub fn validate_supported_asset(
    env: &Env,
    asset: &Address,
    admin: &Address,
) -> Result<AssetProbe, ContractError> {
    let token = token::Client::new(env, asset);
    let admin_balance = token.balance(admin);
    let escrow_balance = token.balance(&env.current_contract_address());
    let decimals = token.decimals();
    let name = token.name();
    let symbol = token.symbol();

    if admin_balance < 0
        || escrow_balance < 0
        || decimals > MAX_TOKEN_DECIMALS
        || name.is_empty()
        || name.len() > MAX_TOKEN_NAME_BYTES
        || symbol.is_empty()
        || symbol.len() > MAX_TOKEN_SYMBOL_BYTES
    {
        return Err(ContractError::InvalidAssetInterface);
    }

    Ok(AssetProbe { decimals })
}

pub fn validate_create_session(
    env: &Env,
    buyer: &Address,
    seller: &Address,
    asset: &Address,
    max_amount: i128,
    expires_at_ledger: u32,
    resource_hash: &BytesN<32>,
) -> Result<(), ContractError> {
    if buyer == seller {
        return Err(ContractError::InvalidSeller);
    }

    if asset == buyer || asset == seller {
        return Err(ContractError::InvalidAsset);
    }

    if max_amount <= 0 {
        return Err(ContractError::InvalidAmount);
    }

    let current_ledger = env.ledger().sequence();
    if expires_at_ledger <= current_ledger {
        return Err(ContractError::ExpiredSession);
    }

    let duration = expires_at_ledger
        .checked_sub(current_ledger)
        .ok_or(ContractError::ExpiredSession)?;
    if duration > MAX_SESSION_DURATION_LEDGERS {
        return Err(ContractError::SessionDurationTooLong);
    }

    if resource_hash == &BytesN::from_array(env, &[0; 32]) {
        return Err(ContractError::InvalidResourceHash);
    }

    Ok(())
}

pub fn validate_settlement_amount(
    env: &Env,
    session: &Session,
    actual_amount: i128,
) -> Result<(), ContractError> {
    if actual_amount <= 0 {
        return Err(ContractError::InvalidAmount);
    }

    if actual_amount > session.max_amount {
        return Err(ContractError::AmountExceedsCap);
    }

    if env.ledger().sequence() >= session.expires_at_ledger {
        return Err(ContractError::ExpiredSession);
    }

    Ok(())
}

pub fn validate_usage_hash(env: &Env, usage_hash: &BytesN<32>) -> Result<(), ContractError> {
    if usage_hash == &BytesN::from_array(env, &[0; 32]) {
        return Err(ContractError::InvalidUsageHash);
    }

    Ok(())
}

pub fn validate_reason_commitment(
    env: &Env,
    reason_commitment: &BytesN<32>,
) -> Result<(), ContractError> {
    if reason_commitment == &BytesN::from_array(env, &[0; 32]) {
        return Err(ContractError::InvalidResourceHash);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Address,
    };

    fn valid_inputs(env: &Env) -> (Address, Address, Address, BytesN<32>) {
        (
            Address::generate(env),
            Address::generate(env),
            Address::generate(env),
            BytesN::from_array(env, &[3; 32]),
        )
    }

    #[test]
    fn accepts_valid_inputs() {
        let env = Env::default();
        let (buyer, seller, asset, resource_hash) = valid_inputs(&env);

        assert_eq!(
            validate_create_session(&env, &buyer, &seller, &asset, 100, 10, &resource_hash),
            Ok(())
        );
    }

    #[test]
    fn asset_caps_must_be_positive() {
        assert_eq!(validate_asset_cap(1), Ok(()));
        assert_eq!(validate_asset_cap(0), Err(ContractError::InvalidAssetCap));
        assert_eq!(validate_asset_cap(-1), Err(ContractError::InvalidAssetCap));
    }

    #[test]
    fn validates_admin_rotation_parties_and_expiry() {
        let env = Env::default();
        env.ledger().set_sequence_number(10);
        let current_admin = Address::generate(&env);
        let pending_admin = Address::generate(&env);

        assert_eq!(
            validate_admin_rotation(
                &env,
                &current_admin,
                &pending_admin,
                10 + MIN_ADMIN_ROTATION_DURATION_LEDGERS
            ),
            Ok(())
        );
        assert_eq!(
            validate_admin_rotation(
                &env,
                &current_admin,
                &pending_admin,
                10 + MAX_ADMIN_ROTATION_DURATION_LEDGERS
            ),
            Ok(())
        );
        assert_eq!(
            validate_admin_rotation(&env, &current_admin, &current_admin, 11),
            Err(ContractError::InvalidAdmin)
        );
        assert_eq!(
            validate_admin_rotation(&env, &current_admin, &pending_admin, 10),
            Err(ContractError::InvalidAdminRotationExpiry)
        );
        assert_eq!(
            validate_admin_rotation(&env, &current_admin, &pending_admin, 9),
            Err(ContractError::InvalidAdminRotationExpiry)
        );
        assert_eq!(
            validate_admin_rotation(
                &env,
                &current_admin,
                &pending_admin,
                10 + MAX_ADMIN_ROTATION_DURATION_LEDGERS + 1
            ),
            Err(ContractError::InvalidAdminRotationExpiry)
        );

        env.ledger().set_sequence_number(u32::MAX - 5);
        assert_eq!(
            validate_admin_rotation(&env, &current_admin, &pending_admin, u32::MAX),
            Err(ContractError::InvalidAdminRotationExpiry)
        );
        env.ledger().set_sequence_number(u32::MAX);
        assert_eq!(
            validate_admin_rotation(&env, &current_admin, &pending_admin, u32::MAX),
            Err(ContractError::InvalidAdminRotationExpiry)
        );
    }

    #[test]
    fn rejects_invalid_amounts() {
        let env = Env::default();
        let (buyer, seller, asset, resource_hash) = valid_inputs(&env);

        assert_eq!(
            validate_create_session(&env, &buyer, &seller, &asset, 0, 10, &resource_hash),
            Err(ContractError::InvalidAmount)
        );
        assert_eq!(
            validate_create_session(&env, &buyer, &seller, &asset, -1, 10, &resource_hash),
            Err(ContractError::InvalidAmount)
        );
    }

    #[test]
    fn rejects_expired_sessions() {
        let env = Env::default();
        env.ledger().set_sequence_number(10);
        let (buyer, seller, asset, resource_hash) = valid_inputs(&env);

        assert_eq!(
            validate_create_session(&env, &buyer, &seller, &asset, 100, 10, &resource_hash),
            Err(ContractError::ExpiredSession)
        );
    }

    #[test]
    fn rejects_empty_resource_hash() {
        let env = Env::default();
        let (buyer, seller, asset, _) = valid_inputs(&env);
        let empty_hash = BytesN::from_array(&env, &[0; 32]);

        assert_eq!(
            validate_create_session(&env, &buyer, &seller, &asset, 100, 10, &empty_hash),
            Err(ContractError::InvalidResourceHash)
        );
    }

    #[test]
    fn rejects_invalid_seller_or_asset_bindings() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let asset = Address::generate(&env);
        let resource_hash = BytesN::from_array(&env, &[3; 32]);

        assert_eq!(
            validate_create_session(&env, &buyer, &buyer, &asset, 100, 10, &resource_hash),
            Err(ContractError::InvalidSeller)
        );
        assert_eq!(
            validate_create_session(&env, &buyer, &seller, &buyer, 100, 10, &resource_hash),
            Err(ContractError::InvalidAsset)
        );
    }

    #[test]
    fn rejects_invalid_settlement_amounts() {
        let env = Env::default();
        let (buyer, seller, asset, resource_hash) = valid_inputs(&env);
        let session = Session {
            id: BytesN::from_array(&env, &[1; 32]),
            buyer,
            seller,
            asset,
            max_amount: 100,
            escrowed_amount: 100,
            settled_amount: 0,
            expires_at_ledger: 50,
            resource_hash,
            usage_hash: None,
            status: crate::SessionStatus::Open,
            creation_ledger: 10,
            finalized_ledger: None,
            resource_scheme_version: 1,
            usage_scheme_version: None,
        };

        assert_eq!(
            validate_settlement_amount(&env, &session, 0),
            Err(ContractError::InvalidAmount)
        );
        assert_eq!(
            validate_settlement_amount(&env, &session, -1),
            Err(ContractError::InvalidAmount)
        );
        assert_eq!(
            validate_settlement_amount(&env, &session, 101),
            Err(ContractError::AmountExceedsCap)
        );
    }

    #[test]
    fn rejects_settlement_at_or_after_expiry() {
        let env = Env::default();
        env.ledger().set_sequence_number(50);
        let (buyer, seller, asset, resource_hash) = valid_inputs(&env);
        let session = Session {
            id: BytesN::from_array(&env, &[1; 32]),
            buyer,
            seller,
            asset,
            max_amount: 100,
            escrowed_amount: 100,
            settled_amount: 0,
            expires_at_ledger: 50,
            resource_hash,
            usage_hash: None,
            status: crate::SessionStatus::Open,
            creation_ledger: 10,
            finalized_ledger: None,
            resource_scheme_version: 1,
            usage_scheme_version: None,
        };

        assert_eq!(
            validate_settlement_amount(&env, &session, 50),
            Err(ContractError::ExpiredSession)
        );
    }

    #[test]
    fn rejects_empty_usage_hash() {
        let env = Env::default();
        let empty_hash = BytesN::from_array(&env, &[0; 32]);

        assert_eq!(
            validate_usage_hash(&env, &empty_hash),
            Err(ContractError::InvalidUsageHash)
        );
    }

    #[test]
    fn validates_session_lifetime_boundary_and_near_u32_limit_ledgers() {
        let env = Env::default();
        let (buyer, seller, asset, resource_hash) = valid_inputs(&env);

        let current = 1_000;
        env.ledger().set_sequence_number(current);

        // Exact boundary succeeds
        assert!(validate_create_session(
            &env,
            &buyer,
            &seller,
            &asset,
            100,
            current + MAX_SESSION_DURATION_LEDGERS,
            &resource_hash
        )
        .is_ok());

        // Boundary + 1 fails
        assert_eq!(
            validate_create_session(
                &env,
                &buyer,
                &seller,
                &asset,
                100,
                current + MAX_SESSION_DURATION_LEDGERS + 1,
                &resource_hash
            ),
            Err(ContractError::SessionDurationTooLong)
        );

        // Near-u32-limit ledgers without overflow
        let near_max = u32::MAX - 1_000;
        env.ledger().set_sequence_number(near_max);

        // Valid horizon near u32 limit succeeds
        assert!(validate_create_session(
            &env,
            &buyer,
            &seller,
            &asset,
            100,
            near_max + 500,
            &resource_hash
        )
        .is_ok());

        assert!(validate_create_session(
            &env,
            &buyer,
            &seller,
            &asset,
            100,
            u32::MAX,
            &resource_hash
        )
        .is_ok());

        // Low current ledger with u32::MAX expiry rejects without overflow
        env.ledger().set_sequence_number(10);
        assert_eq!(
            validate_create_session(&env, &buyer, &seller, &asset, 100, u32::MAX, &resource_hash),
            Err(ContractError::SessionDurationTooLong)
        );

        // Terminal u32 ledger rejects expiry equal to current
        env.ledger().set_sequence_number(u32::MAX);
        assert_eq!(
            validate_create_session(&env, &buyer, &seller, &asset, 100, u32::MAX, &resource_hash),
            Err(ContractError::ExpiredSession)
        );
    }
}
