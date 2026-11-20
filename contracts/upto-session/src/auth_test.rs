extern crate std;

use crate::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger as _, MockAuth,
        MockAuthInvoke,
    },
    token, Address, Env, IntoVal, Symbol, Val, Vec as SorobanVec,
};

#[contract]
struct EscrowAuthorizationHarness;

#[contractimpl]
impl EscrowAuthorizationHarness {
    pub fn fund(env: Env, buyer: Address, asset: Address, amount: i128) {
        buyer.require_auth();
        token::Client::new(&env, &asset).transfer(&buyer, env.current_contract_address(), &amount);
    }

    pub fn settle(
        env: Env,
        _session_id: BytesN<32>,
        seller: Address,
        buyer: Address,
        asset: Address,
        actual_amount: i128,
        refund_amount: i128,
    ) {
        seller.require_auth();
        let escrow = env.current_contract_address();
        let token = token::Client::new(&env, &asset);
        token.transfer(&escrow, &seller, &actual_amount);
        if refund_amount > 0 {
            token.transfer(&escrow, &buyer, &refund_amount);
        }
    }
}

struct TestIdentities {
    admin: Address,
    buyer: Address,
    seller: Address,
    attacker: Address,
}

impl TestIdentities {
    fn generate(env: &Env) -> Self {
        Self {
            admin: Address::generate(env),
            buyer: Address::generate(env),
            seller: Address::generate(env),
            attacker: Address::generate(env),
        }
    }

    fn assert_distinct(&self) {
        assert_ne!(self.admin, self.buyer);
        assert_ne!(self.admin, self.seller);
        assert_ne!(self.admin, self.attacker);
        assert_ne!(self.buyer, self.seller);
        assert_ne!(self.buyer, self.attacker);
        assert_ne!(self.seller, self.attacker);
    }
}

fn create_test_asset(env: &Env, owner: &Address, amount: i128) -> Address {
    let token_admin = Address::generate(env);
    let asset = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    token::StellarAssetClient::new(env, &asset)
        .mock_auths(&[MockAuth {
            address: &token_admin,
            invoke: &MockAuthInvoke {
                contract: &asset,
                fn_name: "mint",
                args: (owner.clone(), amount).into_val(env),
                sub_invokes: &[],
            },
        }])
        .mint(owner, &amount);
    asset
}

fn contract_invocation(
    env: &Env,
    contract: &Address,
    fn_name: &str,
    args: SorobanVec<Val>,
    sub_invocations: std::vec::Vec<AuthorizedInvocation>,
) -> AuthorizedInvocation {
    AuthorizedInvocation {
        function: AuthorizedFunction::Contract((contract.clone(), Symbol::new(env, fn_name), args)),
        sub_invocations,
    }
}

fn token_transfer_invocation(
    env: &Env,
    asset: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) -> AuthorizedInvocation {
    contract_invocation(
        env,
        asset,
        "transfer",
        (from.clone(), to.clone(), amount).into_val(env),
        std::vec![],
    )
}

struct SettlementExpectation<'a> {
    contract: &'a Address,
    session_id: &'a BytesN<32>,
    seller: &'a Address,
    buyer: &'a Address,
    asset: &'a Address,
    actual_amount: i128,
    refund_amount: i128,
}

fn settlement_invocation(env: &Env, expected: SettlementExpectation<'_>) -> AuthorizedInvocation {
    contract_invocation(
        env,
        expected.contract,
        "settle",
        (
            expected.session_id.clone(),
            expected.seller.clone(),
            expected.buyer.clone(),
            expected.asset.clone(),
            expected.actual_amount,
            expected.refund_amount,
        )
            .into_val(env),
        std::vec![],
    )
}

fn assert_single_authorization(env: &Env, authorizer: &Address, expected: AuthorizedInvocation) {
    assert_eq!(env.auths(), std::vec![(authorizer.clone(), expected)]);
}

#[test]
fn escrow_funding_uses_exact_buyer_and_token_transfer_tree() {
    let env = Env::default();
    let identities = TestIdentities::generate(&env);
    identities.assert_distinct();
    let contract_id = env.register(EscrowAuthorizationHarness, ());
    let client = EscrowAuthorizationHarnessClient::new(&env, &contract_id);
    let asset = create_test_asset(&env, &identities.buyer, 500);

    client
        .mock_auths(&[MockAuth {
            address: &identities.buyer,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "fund",
                args: (identities.buyer.clone(), asset.clone(), 500_i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &asset,
                    fn_name: "transfer",
                    args: (identities.buyer.clone(), contract_id.clone(), 500_i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }])
        .fund(&identities.buyer, &asset, &500);

    assert_single_authorization(
        &env,
        &identities.buyer,
        contract_invocation(
            &env,
            &contract_id,
            "fund",
            (identities.buyer.clone(), asset.clone(), 500_i128).into_val(&env),
            std::vec![token_transfer_invocation(
                &env,
                &asset,
                &identities.buyer,
                &contract_id,
                500,
            )],
        ),
    );
    assert_eq!(
        token::Client::new(&env, &asset).balance(&identities.buyer),
        0
    );
    assert_eq!(token::Client::new(&env, &asset).balance(&contract_id), 500);
}

#[test]
fn escrow_payout_needs_only_the_seller_authorization() {
    let env = Env::default();
    let identities = TestIdentities::generate(&env);
    let contract_id = env.register(EscrowAuthorizationHarness, ());
    let client = EscrowAuthorizationHarnessClient::new(&env, &contract_id);
    let asset = create_test_asset(&env, &contract_id, 500);
    let session_id = BytesN::from_array(&env, &[43; 32]);

    client
        .mock_auths(&[MockAuth {
            address: &identities.seller,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "settle",
                args: (
                    session_id.clone(),
                    identities.seller.clone(),
                    identities.buyer.clone(),
                    asset.clone(),
                    125_i128,
                    375_i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }])
        .settle(
            &session_id,
            &identities.seller,
            &identities.buyer,
            &asset,
            &125,
            &375,
        );

    assert_single_authorization(
        &env,
        &identities.seller,
        settlement_invocation(
            &env,
            SettlementExpectation {
                contract: &contract_id,
                session_id: &session_id,
                seller: &identities.seller,
                buyer: &identities.buyer,
                asset: &asset,
                actual_amount: 125,
                refund_amount: 375,
            },
        ),
    );
    let token = token::Client::new(&env, &asset);
    assert_eq!(token.balance(&identities.seller), 125);
    assert_eq!(token.balance(&identities.buyer), 375);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn production_escrow_funds_and_settles_with_exact_authorization_trees() {
    let env = Env::default();
    let identities = TestIdentities::generate(&env);
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let asset = create_test_asset(&env, &identities.buyer, 500);
    let resource_hash = BytesN::from_array(&env, &[41; 32]);
    let idempotency_key = BytesN::from_array(&env, &[44; 32]);
    let usage_hash = BytesN::from_array(&env, &[42; 32]);
    let asset_policies = soroban_sdk::vec![
        &env,
        AssetPolicy {
            asset: asset.clone(),
            max_session_amount: 500,
            min_session_amount: 1,
            max_asset_exposure: 500,
            max_buyer_exposure: 500,
        }
    ];

    client
        .mock_auths(&[MockAuth {
            address: &identities.admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "initialize",
                args: (identities.admin.clone(), asset_policies.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .initialize(&identities.admin, &asset_policies);

    let session_id = client
        .mock_auths(&[MockAuth {
            address: &identities.buyer,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "create_session",
                args: (
                    identities.buyer.clone(),
                    identities.seller.clone(),
                    asset.clone(),
                    500_i128,
                    50_u32,
                    resource_hash.clone(),
                    idempotency_key.clone(),
                )
                    .into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &asset,
                    fn_name: "transfer",
                    args: (
                        identities.buyer.clone(),
                        contract_id.clone(),
                        500_i128,
                    )
                        .into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }])
        .create_session(
            &identities.buyer,
            &identities.seller,
            &asset,
            &500,
            &50,
            &resource_hash,
            &idempotency_key,
        );

    client
        .mock_auths(&[MockAuth {
            address: &identities.seller,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "settle",
                args: (session_id.clone(), 125_i128, usage_hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .settle(&session_id, &125, &usage_hash);

    let session = client.get_session(&session_id);
    assert_eq!(session.status, SessionStatus::Settled);
    assert_eq!(session.settled_amount, 125);
    assert_eq!(session.escrowed_amount, 0);
    let token = token::Client::new(&env, &asset);
    assert_eq!(token.balance(&identities.buyer), 375);
    assert_eq!(token.balance(&identities.seller), 125);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn escrow_funding_rejects_an_attacker_authorization() {
    let env = Env::default();
    let identities = TestIdentities::generate(&env);
    let contract_id = env.register(EscrowAuthorizationHarness, ());
    let client = EscrowAuthorizationHarnessClient::new(&env, &contract_id);
    let asset = create_test_asset(&env, &identities.buyer, 500);

    let result = client
        .mock_auths(&[MockAuth {
            address: &identities.attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "fund",
                args: (identities.buyer.clone(), asset.clone(), 500_i128).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_fund(&identities.buyer, &asset, &500);

    assert!(result.is_err());
    assert_eq!(
        token::Client::new(&env, &asset).balance(&identities.buyer),
        500
    );
    assert_eq!(token::Client::new(&env, &asset).balance(&contract_id), 0);
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum AuthRole {
    Admin,
    PendingAdmin,
    Buyer,
    Seller,
    Attacker,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum AdminMethodCategory {
    Bootstrap,
    AssetLifecycle,
    AssetCapsAndLimits,
    ExposureCeilings,
    OperationalPause,
    AdminRotation,
    TreasuryRecovery,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
struct AdminAuthMatrixRow {
    method: &'static str,
    category: AdminMethodCategory,
    required_auth: AuthRole,
    forbidden_callers: &'static [AuthRole],
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum NonAdminMethodClass {
    Buyer,
    Seller,
    BuyerAndSeller,
    Permissionless,
    ReadOnly,
}

const STANDARD_ADMIN_FORBIDDEN: &[AuthRole] = &[
    AuthRole::Buyer,
    AuthRole::Seller,
    AuthRole::Attacker,
    AuthRole::PendingAdmin,
];

const PENDING_ADMIN_FORBIDDEN: &[AuthRole] = &[
    AuthRole::Admin,
    AuthRole::Buyer,
    AuthRole::Seller,
    AuthRole::Attacker,
];

/// Auditable authorization coverage matrix for every administrative entrypoint
/// on `UptoSessionContract`. Adding any new `pub fn` to `UptoSessionContract`
/// without classifying it in either `ADMIN_METHOD_AUTH_MATRIX` or
/// `NON_ADMIN_PUBLIC_METHODS` fails `all_contract_entrypoints_are_classified_and_covered`.
const ADMIN_METHOD_AUTH_MATRIX: &[AdminAuthMatrixRow] = &[
    AdminAuthMatrixRow {
        method: "initialize",
        category: AdminMethodCategory::Bootstrap,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "activate_asset",
        category: AdminMethodCategory::AssetLifecycle,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "deprecate_asset",
        category: AdminMethodCategory::AssetLifecycle,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "remove_asset",
        category: AdminMethodCategory::AssetLifecycle,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "set_asset_max_session_amount",
        category: AdminMethodCategory::AssetCapsAndLimits,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "propose_asset_cap_increase",
        category: AdminMethodCategory::AssetCapsAndLimits,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "accept_asset_cap_increase",
        category: AdminMethodCategory::AssetCapsAndLimits,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "cancel_asset_cap_increase",
        category: AdminMethodCategory::AssetCapsAndLimits,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "set_max_buyer_open_sessions",
        category: AdminMethodCategory::AssetCapsAndLimits,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "set_max_seller_open_sessions",
        category: AdminMethodCategory::AssetCapsAndLimits,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "set_asset_exposure_ceiling",
        category: AdminMethodCategory::ExposureCeilings,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "set_buyer_exposure_ceiling",
        category: AdminMethodCategory::ExposureCeilings,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "set_seller_exposure_ceiling",
        category: AdminMethodCategory::ExposureCeilings,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "pause_creation",
        category: AdminMethodCategory::OperationalPause,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "resume_creation",
        category: AdminMethodCategory::OperationalPause,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "propose_admin",
        category: AdminMethodCategory::AdminRotation,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "accept_admin",
        category: AdminMethodCategory::AdminRotation,
        required_auth: AuthRole::PendingAdmin,
        forbidden_callers: PENDING_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "cancel_admin_rotation",
        category: AdminMethodCategory::AdminRotation,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
    AdminAuthMatrixRow {
        method: "recover_surplus",
        category: AdminMethodCategory::TreasuryRecovery,
        required_auth: AuthRole::Admin,
        forbidden_callers: STANDARD_ADMIN_FORBIDDEN,
    },
];

const NON_ADMIN_PUBLIC_METHODS: &[(&str, NonAdminMethodClass)] = &[
    ("interface_version", NonAdminMethodClass::ReadOnly),
    ("max_session_duration_ledgers", NonAdminMethodClass::ReadOnly),
    ("get_asset_cap_increase", NonAdminMethodClass::ReadOnly),
    ("get_seller_exposure_ceiling", NonAdminMethodClass::ReadOnly),
    ("get_seller_exposure", NonAdminMethodClass::ReadOnly),
    ("get_max_buyer_open_sessions", NonAdminMethodClass::ReadOnly),
    ("get_buyer_open_sessions", NonAdminMethodClass::ReadOnly),
    ("get_buyer_session_count", NonAdminMethodClass::ReadOnly),
    ("get_max_seller_open_sessions", NonAdminMethodClass::ReadOnly),
    ("get_seller_open_sessions", NonAdminMethodClass::ReadOnly),
    ("get_asset_policy", NonAdminMethodClass::ReadOnly),
    ("get_asset_max_session_amount", NonAdminMethodClass::ReadOnly),
    ("get_asset_min_session_amount", NonAdminMethodClass::ReadOnly),
    ("get_asset_exposure_ceiling", NonAdminMethodClass::ReadOnly),
    ("get_buyer_exposure_ceiling", NonAdminMethodClass::ReadOnly),
    ("get_buyer_exposure", NonAdminMethodClass::ReadOnly),
    ("get_admin", NonAdminMethodClass::ReadOnly),
    ("get_admin_rotation", NonAdminMethodClass::ReadOnly),
    ("get_configuration", NonAdminMethodClass::ReadOnly),
    ("get_commitment_domain_metadata", NonAdminMethodClass::ReadOnly),
    ("get_initialization_digest", NonAdminMethodClass::ReadOnly),
    ("get_session_state_counts", NonAdminMethodClass::ReadOnly),
    ("get_seller_session_counts", NonAdminMethodClass::ReadOnly),
    ("get_sessions_by_commitment", NonAdminMethodClass::ReadOnly),
    ("preview_settle", NonAdminMethodClass::ReadOnly),
    ("get_recoverability", NonAdminMethodClass::ReadOnly),
    ("get_solvency", NonAdminMethodClass::ReadOnly),
    ("get_session", NonAdminMethodClass::ReadOnly),
    ("get_terminal_evidence", NonAdminMethodClass::ReadOnly),
    ("get_session_batch", NonAdminMethodClass::ReadOnly),
    ("get_session_status", NonAdminMethodClass::ReadOnly),
    ("get_escrow_liability", NonAdminMethodClass::ReadOnly),
    ("get_asset_solvency", NonAdminMethodClass::ReadOnly),
    ("create_session", NonAdminMethodClass::Buyer),
    ("cancel", NonAdminMethodClass::Buyer),
    ("reduce_session_cap", NonAdminMethodClass::Buyer),
    ("settle", NonAdminMethodClass::Seller),
    ("reject", NonAdminMethodClass::Seller),
    ("extend_session_expiry", NonAdminMethodClass::BuyerAndSeller),
    ("recover_expired", NonAdminMethodClass::Permissionless),
    ("recover_expired_batch", NonAdminMethodClass::Permissionless),
    ("extend_ttl", NonAdminMethodClass::Permissionless),
];

fn extract_contract_entrypoints(source: &str) -> std::vec::Vec<(std::string::String, std::string::String)> {
    let impl_marker = "impl UptoSessionContract {";
    let start = source
        .find(impl_marker)
        .expect("UptoSessionContract impl block must exist in lib.rs")
        + impl_marker.len();
    let tail = &source[start..];

    let mut depth: i32 = 1;
    let mut impl_end = tail.len();
    for (idx, ch) in tail.char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    impl_end = idx;
                    break;
                }
            }
            _ => {}
        }
    }
    let impl_body = &tail[..impl_end];

    let mut methods = std::vec::Vec::new();
    let mut method_starts = std::vec::Vec::new();
    let mut offset = 0usize;
    for line in impl_body.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("pub fn ") {
            let name: std::string::String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            if !name.is_empty() {
                method_starts.push((name, offset));
            }
        }
        offset += line.len();
    }

    for (idx, (name, start_pos)) in method_starts.iter().enumerate() {
        let end_pos = method_starts
            .get(idx + 1)
            .map(|(_, next)| *next)
            .unwrap_or(impl_body.len());
        methods.push((
            name.clone(),
            std::string::String::from(&impl_body[*start_pos..end_pos]),
        ));
    }

    methods
}

fn body_requires_admin_auth(body: &str) -> bool {
    body.contains("require_admin(")
        || body.contains("admin.require_auth()")
        || body.contains("current_admin.require_auth()")
        || body.contains("pending_admin.require_auth()")
}

struct MatrixRoles {
    admin: Address,
    pending_admin: Address,
    buyer: Address,
    seller: Address,
    attacker: Address,
}

impl MatrixRoles {
    fn generate(env: &Env) -> Self {
        Self {
            admin: Address::generate(env),
            pending_admin: Address::generate(env),
            buyer: Address::generate(env),
            seller: Address::generate(env),
            attacker: Address::generate(env),
        }
    }

    fn address(&self, role: AuthRole) -> &Address {
        match role {
            AuthRole::Admin => &self.admin,
            AuthRole::PendingAdmin => &self.pending_admin,
            AuthRole::Buyer => &self.buyer,
            AuthRole::Seller => &self.seller,
            AuthRole::Attacker => &self.attacker,
        }
    }
}

struct AdminMethodHarness {
    env: Env,
    contract_id: Address,
    roles: MatrixRoles,
    asset: Address,
    secondary_asset: Address,
    reason_commitment: BytesN<32>,
}

impl AdminMethodHarness {
    fn new(initialize_contract: bool) -> Self {
        let env = Env::default();
        env.ledger().set_sequence_number(100);
        let roles = MatrixRoles::generate(&env);
        let contract_id = env.register(UptoSessionContract, ());
        let asset = create_test_asset(&env, &roles.buyer, 2_000);
        let secondary_asset = create_test_asset(&env, &roles.buyer, 2_000);
        let reason_commitment = BytesN::from_array(&env, &[0x5a; 32]);

        if initialize_contract {
            let client = UptoSessionContractClient::new(&env, &contract_id);
            let policies = soroban_sdk::vec![
                &env,
                AssetPolicy {
                    asset: asset.clone(),
                    max_session_amount: 1_000,
                    min_session_amount: 10,
                    max_asset_exposure: 5_000,
                    max_buyer_exposure: 2_500,
                }
            ];
            client
                .mock_auths(&[MockAuth {
                    address: &roles.admin,
                    invoke: &MockAuthInvoke {
                        contract: &contract_id,
                        fn_name: "initialize",
                        args: (roles.admin.clone(), policies.clone()).into_val(&env),
                        sub_invokes: &[],
                    },
                }])
                .initialize(&roles.admin, &policies);
        }

        Self {
            env,
            contract_id,
            roles,
            asset,
            secondary_asset,
            reason_commitment,
        }
    }

    fn prepare_for(&self, method: &str) {
        let client = UptoSessionContractClient::new(&self.env, &self.contract_id);
        match method {
            "accept_asset_cap_increase" | "cancel_asset_cap_increase" => {
                let active_at = 100 + validation::MIN_CAP_INCREASE_DELAY_LEDGERS;
                let expires_at = active_at + 50;
                client
                    .mock_auths(&[MockAuth {
                        address: &self.roles.admin,
                        invoke: &MockAuthInvoke {
                            contract: &self.contract_id,
                            fn_name: "propose_asset_cap_increase",
                            args: (self.asset.clone(), 1_500_i128, active_at, expires_at)
                                .into_val(&self.env),
                            sub_invokes: &[],
                        },
                    }])
                    .propose_asset_cap_increase(&self.asset, &1_500, &active_at, &expires_at);
                if method == "accept_asset_cap_increase" {
                    self.env.ledger().set_sequence_number(active_at);
                }
            }
            "remove_asset" => {
                client
                    .mock_auths(&[MockAuth {
                        address: &self.roles.admin,
                        invoke: &MockAuthInvoke {
                            contract: &self.contract_id,
                            fn_name: "deprecate_asset",
                            args: (self.asset.clone(), self.reason_commitment.clone())
                                .into_val(&self.env),
                            sub_invokes: &[],
                        },
                    }])
                    .deprecate_asset(&self.asset, &self.reason_commitment);
            }
            "resume_creation" => {
                client
                    .mock_auths(&[MockAuth {
                        address: &self.roles.admin,
                        invoke: &MockAuthInvoke {
                            contract: &self.contract_id,
                            fn_name: "pause_creation",
                            args: ().into_val(&self.env),
                            sub_invokes: &[],
                        },
                    }])
                    .pause_creation();
            }
            "accept_admin" | "cancel_admin_rotation" => {
                let expires_at = 200_u32;
                client
                    .mock_auths(&[MockAuth {
                        address: &self.roles.admin,
                        invoke: &MockAuthInvoke {
                            contract: &self.contract_id,
                            fn_name: "propose_admin",
                            args: (self.roles.pending_admin.clone(), expires_at)
                                .into_val(&self.env),
                            sub_invokes: &[],
                        },
                    }])
                    .propose_admin(&self.roles.pending_admin, &expires_at);
            }
            "recover_surplus" => {
                token::Client::new(&self.env, &self.asset)
                    .mock_auths(&[MockAuth {
                        address: &self.roles.buyer,
                        invoke: &MockAuthInvoke {
                            contract: &self.asset,
                            fn_name: "transfer",
                            args: (
                                self.roles.buyer.clone(),
                                self.contract_id.clone(),
                                250_i128,
                            )
                                .into_val(&self.env),
                            sub_invokes: &[],
                        },
                    }])
                    .transfer(&self.roles.buyer, &self.contract_id, &250);
            }
            _ => {}
        }
    }

    fn invoke_admin_method(&self, method: &str, signer: Option<AuthRole>) -> (bool, SorobanVec<Val>) {
        let client = UptoSessionContractClient::new(&self.env, &self.contract_id);
        let args = self.args_for(method);
        let invoke = MockAuthInvoke {
            contract: &self.contract_id,
            fn_name: method,
            args: args.clone(),
            sub_invokes: &[],
        };
        let auths: std::vec::Vec<MockAuth<'_>> = match signer {
            Some(role) => std::vec![MockAuth {
                address: self.roles.address(role),
                invoke: &invoke,
            }],
            None => std::vec![],
        };
        let authed = client.mock_auths(&auths);

        let ok = match method {
            "initialize" => {
                let policies = soroban_sdk::vec![
                    &self.env,
                    AssetPolicy {
                        asset: self.asset.clone(),
                        max_session_amount: 1_000,
                        min_session_amount: 10,
                        max_asset_exposure: 5_000,
                        max_buyer_exposure: 2_500,
                    }
                ];
                authed.try_initialize(&self.roles.admin, &policies).is_ok()
            }
            "activate_asset" => {
                let policy = AssetPolicy {
                    asset: self.secondary_asset.clone(),
                    max_session_amount: 800,
                    min_session_amount: 10,
                    max_asset_exposure: 4_000,
                    max_buyer_exposure: 2_000,
                };
                authed.try_activate_asset(&policy).is_ok()
            }
            "deprecate_asset" => authed
                .try_deprecate_asset(&self.asset, &self.reason_commitment)
                .is_ok(),
            "remove_asset" => authed
                .try_remove_asset(&self.asset, &self.reason_commitment)
                .is_ok(),
            "set_asset_max_session_amount" => authed
                .try_set_asset_max_session_amount(&self.asset, &500)
                .is_ok(),
            "propose_asset_cap_increase" => {
                let active_at = 100 + validation::MIN_CAP_INCREASE_DELAY_LEDGERS;
                let expires_at = active_at + 50;
                authed
                    .try_propose_asset_cap_increase(&self.asset, &1_500, &active_at, &expires_at)
                    .is_ok()
            }
            "accept_asset_cap_increase" => {
                authed.try_accept_asset_cap_increase(&self.asset).is_ok()
            }
            "cancel_asset_cap_increase" => {
                authed.try_cancel_asset_cap_increase(&self.asset).is_ok()
            }
            "set_max_buyer_open_sessions" => authed.try_set_max_buyer_open_sessions(&5).is_ok(),
            "set_max_seller_open_sessions" => authed.try_set_max_seller_open_sessions(&5).is_ok(),
            "set_asset_exposure_ceiling" => authed
                .try_set_asset_exposure_ceiling(&self.asset, &6_000)
                .is_ok(),
            "set_buyer_exposure_ceiling" => authed
                .try_set_buyer_exposure_ceiling(&self.asset, &3_000)
                .is_ok(),
            "set_seller_exposure_ceiling" => authed
                .try_set_seller_exposure_ceiling(&self.asset, &3_000)
                .is_ok(),
            "pause_creation" => authed.try_pause_creation().is_ok(),
            "resume_creation" => authed.try_resume_creation().is_ok(),
            "propose_admin" => authed
                .try_propose_admin(&self.roles.pending_admin, &200)
                .is_ok(),
            "accept_admin" => authed.try_accept_admin().is_ok(),
            "cancel_admin_rotation" => authed.try_cancel_admin_rotation().is_ok(),
            "recover_surplus" => authed
                .try_recover_surplus(&self.asset, &self.roles.admin, &100)
                .is_ok(),
            other => panic!("Unhandled admin method in authorization matrix harness: {other}"),
        };

        (ok, args)
    }

    fn args_for(&self, method: &str) -> SorobanVec<Val> {
        match method {
            "initialize" => {
                let policies = soroban_sdk::vec![
                    &self.env,
                    AssetPolicy {
                        asset: self.asset.clone(),
                        max_session_amount: 1_000,
                        min_session_amount: 10,
                        max_asset_exposure: 5_000,
                        max_buyer_exposure: 2_500,
                    }
                ];
                (self.roles.admin.clone(), policies).into_val(&self.env)
            }
            "activate_asset" => {
                let policy = AssetPolicy {
                    asset: self.secondary_asset.clone(),
                    max_session_amount: 800,
                    min_session_amount: 10,
                    max_asset_exposure: 4_000,
                    max_buyer_exposure: 2_000,
                };
                (policy,).into_val(&self.env)
            }
            "deprecate_asset" | "remove_asset" => {
                (self.asset.clone(), self.reason_commitment.clone()).into_val(&self.env)
            }
            "set_asset_max_session_amount" => (self.asset.clone(), 500_i128).into_val(&self.env),
            "propose_asset_cap_increase" => {
                let active_at = 100 + validation::MIN_CAP_INCREASE_DELAY_LEDGERS;
                let expires_at = active_at + 50;
                (self.asset.clone(), 1_500_i128, active_at, expires_at).into_val(&self.env)
            }
            "accept_asset_cap_increase" | "cancel_asset_cap_increase" => {
                (self.asset.clone(),).into_val(&self.env)
            }
            "set_max_buyer_open_sessions" | "set_max_seller_open_sessions" => {
                (5_u32,).into_val(&self.env)
            }
            "set_asset_exposure_ceiling" => (self.asset.clone(), 6_000_i128).into_val(&self.env),
            "set_buyer_exposure_ceiling" | "set_seller_exposure_ceiling" => {
                (self.asset.clone(), 3_000_i128).into_val(&self.env)
            }
            "pause_creation"
            | "resume_creation"
            | "accept_admin"
            | "cancel_admin_rotation" => ().into_val(&self.env),
            "propose_admin" => (self.roles.pending_admin.clone(), 200_u32).into_val(&self.env),
            "recover_surplus" => {
                (self.asset.clone(), self.roles.admin.clone(), 100_i128).into_val(&self.env)
            }
            other => panic!("Unhandled admin method in args_for: {other}"),
        }
    }
}

#[test]
fn all_contract_entrypoints_are_classified_and_covered_by_admin_matrix() {
    let source = include_str!("lib.rs");
    let discovered = extract_contract_entrypoints(source);
    assert!(
        !discovered.is_empty(),
        "must discover UptoSessionContract public methods from lib.rs"
    );

    let mut admin_names = std::collections::BTreeSet::new();
    for row in ADMIN_METHOD_AUTH_MATRIX {
        assert!(
            admin_names.insert(row.method),
            "duplicate admin method in ADMIN_METHOD_AUTH_MATRIX: {}",
            row.method
        );
        assert!(
            !row.forbidden_callers.is_empty(),
            "admin method {} must enumerate forbidden callers",
            row.method
        );
        assert!(
            !row.forbidden_callers.contains(&row.required_auth),
            "admin method {} cannot list its required authorizer as forbidden",
            row.method
        );
    }

    let mut non_admin_names = std::collections::BTreeSet::new();
    for (name, _) in NON_ADMIN_PUBLIC_METHODS {
        assert!(
            non_admin_names.insert(*name),
            "duplicate non-admin method in NON_ADMIN_PUBLIC_METHODS: {name}"
        );
        assert!(
            !admin_names.contains(*name),
            "method {name} cannot appear in both admin and non-admin classification tables"
        );
    }

    let mut discovered_names = std::collections::BTreeSet::new();
    let mut unclassified = std::vec::Vec::new();
    let mut misclassified_admin = std::vec::Vec::new();

    for (name, body) in &discovered {
        discovered_names.insert(name.as_str());
        let in_admin = admin_names.contains(name.as_str());
        let in_non_admin = non_admin_names.contains(name.as_str());
        if !in_admin && !in_non_admin {
            unclassified.push(name.clone());
            continue;
        }
        if body_requires_admin_auth(body) && !in_admin {
            misclassified_admin.push(name.clone());
        }
    }

    assert!(
        unclassified.is_empty(),
        "Unclassified UptoSessionContract entrypoint(s) found in lib.rs: {:?}. Add each method to ADMIN_METHOD_AUTH_MATRIX (with auth tests) or NON_ADMIN_PUBLIC_METHODS.",
        unclassified
    );
    assert!(
        misclassified_admin.is_empty(),
        "Method(s) calling admin authorization must be listed in ADMIN_METHOD_AUTH_MATRIX: {:?}",
        misclassified_admin
    );

    for name in &admin_names {
        assert!(
            discovered_names.contains(name),
            "Stale method in ADMIN_METHOD_AUTH_MATRIX not found in lib.rs: {name}"
        );
    }
    for name in &non_admin_names {
        assert!(
            discovered_names.contains(name),
            "Stale method in NON_ADMIN_PUBLIC_METHODS not found in lib.rs: {name}"
        );
    }
}

#[test]
fn admin_method_authorization_matrix_enforces_required_missing_and_forbidden_callers() {
    for row in ADMIN_METHOD_AUTH_MATRIX {
        let initialize_first = row.method != "initialize";

        // 1. Missing authorization must fail closed.
        let missing_auth = AdminMethodHarness::new(initialize_first);
        missing_auth.prepare_for(row.method);
        let (ok, _) = missing_auth.invoke_admin_method(row.method, None);
        assert!(
            !ok,
            "admin method `{}` ({:?}) succeeded without authorization",
            row.method, row.category
        );

        // 2. Every forbidden caller must be rejected.
        for &forbidden in row.forbidden_callers {
            let wrong_caller = AdminMethodHarness::new(initialize_first);
            wrong_caller.prepare_for(row.method);
            let (ok, _) = wrong_caller.invoke_admin_method(row.method, Some(forbidden));
            assert!(
                !ok,
                "admin method `{}` ({:?}) accepted forbidden caller {:?}",
                row.method, row.category, forbidden
            );
        }

        // 3. Exact required authorizer must succeed and record the single expected invocation.
        let happy = AdminMethodHarness::new(initialize_first);
        happy.prepare_for(row.method);
        let (ok, args) = happy.invoke_admin_method(row.method, Some(row.required_auth));
        assert!(
            ok,
            "admin method `{}` ({:?}) failed with required authorizer {:?}",
            row.method, row.category, row.required_auth
        );
        assert_single_authorization(
            &happy.env,
            happy.roles.address(row.required_auth),
            contract_invocation(&happy.env, &happy.contract_id, row.method, args, std::vec![]),
        );
    }
}
