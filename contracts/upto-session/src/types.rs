use soroban_sdk::{contracttype, Address, BytesN, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetPolicy {
    pub asset: Address,
    pub max_session_amount: i128,
    /// Ceiling on the sum of open escrow for this asset across all sessions.
    pub max_asset_exposure: i128,
    /// Ceiling on the sum of open escrow for this asset held by any one buyer.
    pub max_buyer_exposure: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminRotation {
    pub pending_admin: Address,
    pub expires_at_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AssetStatus {
    Active,
    Deprecated,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SessionStatus {
    Open,
    Settled,
    Cancelled,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Session {
    pub id: BytesN<32>,
    pub buyer: Address,
    pub seller: Address,
    pub asset: Address,
    pub max_amount: i128,
    pub escrowed_amount: i128,
    pub settled_amount: i128,
    pub expires_at_ledger: u32,
    pub resource_hash: BytesN<32>,
    pub usage_hash: Option<BytesN<32>>,
    pub status: SessionStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OperationalState {
    Active,
    Paused,
    Deprecated,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BatchRecoveryStatus {
    Recovered,
    NotFound,
    NotExpired,
    AlreadySettled,
    AlreadyCancelled,
    AlreadyRecovered,
    Duplicate,
    EscrowUnavailable,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractConfiguration {
    pub response_version: u32,
    pub interface_version: u32,
    pub storage_layout_version: u32,
    pub admin: Address,
    pub supported_assets: Vec<Address>,
    pub max_supported_assets: u32,
    pub operational_state: OperationalState,
    pub instance_ttl_threshold: u32,
    pub instance_ttl_extension: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SolvencyStatus {
    /// Token balance equals tracked liability.
    Collateralized,
    /// Token balance exceeds tracked liability; `surplus` is positive.
    Surplus,
    /// Token balance is below tracked liability; `deficit` is positive.
    Underfunded,
    /// The token balance call failed or returned a value that cannot be a
    /// balance. Never healthy.
    BalanceUnavailable,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetSolvencySnapshot {
    pub response_version: u32,
    pub asset: Address,
    pub asset_status: AssetStatus,
    /// Balance reported by the token for this contract, or `None` when the
    /// balance call failed.
    pub token_balance: Option<i128>,
    pub liability: i128,
    /// `token_balance - liability` when positive, otherwise `0`.
    pub surplus: i128,
    /// `liability - token_balance` when positive, otherwise `0`.
    pub deficit: i128,
    pub status: SolvencyStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchRecoveryResult {
    pub session_id: BytesN<32>,
    pub status: BatchRecoveryStatus,
    pub refunded_amount: i128,
}
