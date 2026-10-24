use soroban_sdk::{contracttype, Address, BytesN, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetPolicy {
    pub asset: Address,
    pub max_session_amount: i128,
    pub min_session_amount: i128,
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
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapIncreaseProposal {
    pub proposed_max_amount: i128,
    pub active_at_ledger: u32,
    pub expires_at_ledger: u32,
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
    pub creation_ledger: u32,
    pub finalized_ledger: Option<u32>,
    pub resource_scheme_version: u32,
    pub usage_scheme_version: Option<u32>,
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
    AlreadyRejected,
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
pub struct BatchRecoveryResult {
    pub session_id: BytesN<32>,
    pub status: BatchRecoveryStatus,
    pub refunded_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SettlementRejectionReason {
    None,
    NotFound,
    AlreadySettled,
    AlreadyCancelled,
    AlreadyExpired,
    AlreadyRejected,
    InvalidAmount,
    AmountExceedsCap,
    Expired,
    EscrowUnderfunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementPreview {
    pub eligible: bool,
    pub actual_amount: i128,
    pub seller_payout: i128,
    pub buyer_refund: i128,
    pub is_expired: bool,
    pub rejection_reason: SettlementRejectionReason,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RecoverabilityStatus {
    NotFound,
    NotExpired,
    Recoverable,
    AlreadySettled,
    AlreadyCancelled,
    AlreadyRecovered,
    AlreadyRejected,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionRecoverability {
    pub response_version: u32,
    pub status: RecoverabilityStatus,
    pub expires_at_ledger: u32,
    pub current_ledger: u32,
    pub recipient: Option<Address>,
    pub asset: Option<Address>,
    pub refundable_amount: i128,
pub struct CommitmentDomainMetadata {
    pub response_version: u32,
    pub interface_version: u32,
    pub receipt_schema_version: u32,
    pub session_id_domain: BytesN<32>,
    pub usage_commitment_domain: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SolvencyAssetState {
    Unknown,
    Active,
    Deprecated,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetSolvency {
    pub asset: Address,
    pub state: SolvencyAssetState,
    pub balance: i128,
    pub liability: i128,
    pub surplus: i128,
pub struct SessionStatusResponse {
    pub exists: bool,
    pub status: SessionStatus,
    pub expires_at_ledger: u32,
}
