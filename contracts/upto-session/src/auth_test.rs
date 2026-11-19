extern crate std;

use crate::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, MockAuth, MockAuthInvoke},
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
                    resource_hash.clone(),
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
            &resource_hash,
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

// ── Issue #174: Account and contract-auth parity matrix ──────────────────────

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    testutils::{Events as _, Ledger as _},
    vec as soroban_vec,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PrincipalKind {
    Account,
    Contract,
}

const PRINCIPAL_KINDS: [PrincipalKind; 2] = [PrincipalKind::Account, PrincipalKind::Contract];

/// Minimal contract principal that can act as an administrator, buyer, or seller
/// both via explicit `MockAuth` trees and via direct cross-contract invocations
/// using `env.authorize_as_current_contract` for nested token transfers.
#[contract]
struct ContractPrincipal;

#[contractimpl]
impl ContractPrincipal {
    pub fn initialize_escrow(
        env: Env,
        escrow: Address,
        policies: soroban_sdk::Vec<AssetPolicy>,
    ) {
        let self_addr = env.current_contract_address();
        UptoSessionContractClient::new(&env, &escrow).initialize(&self_addr, &policies);
    }

    pub fn open_session(
        env: Env,
        escrow: Address,
        seller: Address,
        asset: Address,
        max_amount: i128,
        expires_at_ledger: u32,
        resource_hash: BytesN<32>,
        idempotency_key: BytesN<32>,
    ) -> BytesN<32> {
        let self_addr = env.current_contract_address();
        // Explicitly authorize the nested token::transfer sub-invocation from this contract.
        env.authorize_as_current_contract(soroban_vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: asset.clone(),
                    fn_name: Symbol::new(&env, "transfer"),
                    args: (self_addr.clone(), escrow.clone(), max_amount).into_val(&env),
                },
                sub_invocations: soroban_vec![&env],
            }),
        ]);
        UptoSessionContractClient::new(&env, &escrow).create_session(
            &self_addr,
            &seller,
            &asset,
            &max_amount,
            &expires_at_ledger,
            &resource_hash,
            &idempotency_key,
        )
    }

    pub fn reduce_cap(env: Env, escrow: Address, session_id: BytesN<32>, new_max_amount: i128) {
        UptoSessionContractClient::new(&env, &escrow)
            .reduce_session_cap(&session_id, &new_max_amount);
    }

    pub fn cancel_session(env: Env, escrow: Address, session_id: BytesN<32>) {
        UptoSessionContractClient::new(&env, &escrow).cancel(&session_id);
    }

    pub fn settle_session(
        env: Env,
        escrow: Address,
        session_id: BytesN<32>,
        actual_amount: i128,
        usage_hash: BytesN<32>,
    ) {
        UptoSessionContractClient::new(&env, &escrow)
            .settle(&session_id, &actual_amount, &usage_hash);
    }

    pub fn reject_session(env: Env, escrow: Address, session_id: BytesN<32>) {
        UptoSessionContractClient::new(&env, &escrow).reject(&session_id);
    }

    pub fn pause_escrow(env: Env, escrow: Address) {
        UptoSessionContractClient::new(&env, &escrow).pause_creation();
    }

    pub fn resume_escrow(env: Env, escrow: Address) {
        UptoSessionContractClient::new(&env, &escrow).resume_creation();
    }
}

fn make_principal(env: &Env, kind: PrincipalKind) -> Address {
    match kind {
        PrincipalKind::Account => Address::generate(env),
        PrincipalKind::Contract => env.register(ContractPrincipal, ()),
    }
}

fn default_policy(asset: &Address, cap: i128) -> AssetPolicy {
    AssetPolicy {
        asset: asset.clone(),
        max_session_amount: cap,
        min_session_amount: 1,
        max_asset_exposure: i128::MAX,
        max_buyer_exposure: i128::MAX,
    }
}

macro_rules! single_mock_auth {
    ($signer:expr, $contract:expr, $fn_name:expr, $args:expr $(,)?) => {
        MockAuth {
            address: $signer,
            invoke: &MockAuthInvoke {
                contract: $contract,
                fn_name: $fn_name,
                args: $args,
                sub_invokes: &[],
            },
        }
    };
}

fn escrow_events_count(env: &Env, contract: &Address) -> usize {
    env.events()
        .all()
        .filter_by_contract(contract)
        .events()
        .len()
}

fn create_session_with_explicit_tree(
    env: &Env,
    client: &UptoSessionContractClient<'_>,
    contract_id: &Address,
    buyer: &Address,
    seller: &Address,
    asset: &Address,
    amount: i128,
    expires_at_ledger: u32,
    resource_hash: &BytesN<32>,
    idempotency_key: &BytesN<32>,
) -> BytesN<32> {
    let args: SorobanVec<Val> = (
        buyer.clone(),
        seller.clone(),
        asset.clone(),
        amount,
        expires_at_ledger,
        resource_hash.clone(),
        idempotency_key.clone(),
    )
        .into_val(env);
    let session_id = client
        .mock_auths(&[MockAuth {
            address: buyer,
            invoke: &MockAuthInvoke {
                contract: contract_id,
                fn_name: "create_session",
                args: args.clone(),
                sub_invokes: &[MockAuthInvoke {
                    contract: asset,
                    fn_name: "transfer",
                    args: (buyer.clone(), contract_id.clone(), amount).into_val(env),
                    sub_invokes: &[],
                }],
            },
        }])
        .create_session(
            buyer,
            seller,
            asset,
            &amount,
            &expires_at_ledger,
            resource_hash,
            idempotency_key,
        );

    assert_single_authorization(
        env,
        buyer,
        contract_invocation(
            env,
            contract_id,
            "create_session",
            args,
            std::vec![token_transfer_invocation(
                env,
                asset,
                buyer,
                contract_id,
                amount,
            )],
        ),
    );
    session_id
}

#[test]
fn auth_parity_matrix_all_role_combinations_across_session_mutations() {
    for admin_kind in PRINCIPAL_KINDS {
        for buyer_kind in PRINCIPAL_KINDS {
            for seller_kind in PRINCIPAL_KINDS {
                let env = Env::default();
                let contract_id = env.register(UptoSessionContract, ());
                let client = UptoSessionContractClient::new(&env, &contract_id);

                let admin = make_principal(&env, admin_kind);
                let buyer = make_principal(&env, buyer_kind);
                let seller = make_principal(&env, seller_kind);
                let asset = create_test_asset(&env, &buyer, 2_000);
                let token = token::Client::new(&env, &asset);
                let policies = soroban_vec![&env, default_policy(&asset, 1_000)];

                // 1. initialize (Account or Contract admin)
                let init_args: SorobanVec<Val> = (admin.clone(), policies.clone()).into_val(&env);
                client
                    .mock_auths(&[MockAuth {
                        address: &admin,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "initialize",
                            args: init_args.clone(),
                            sub_invokes: &[],
                        },
                    }])
                    .initialize(&admin, &policies);
                assert_single_authorization(
                    &env,
                    &admin,
                    contract_invocation(&env, &contract_id, "initialize", init_args, std::vec![]),
                );

                // 2. create_session with explicit nested token::transfer sub-invocation
                let r1 = BytesN::from_array(&env, &[0x11; 32]);
                let k1 = BytesN::from_array(&env, &[0x21; 32]);
                let s_settle = create_session_with_explicit_tree(
                    &env,
                    &client,
                    &contract_id,
                    &buyer,
                    &seller,
                    &asset,
                    500,
                    50,
                    &r1,
                    &k1,
                );

                // 2b. Idempotent replay requires buyer auth on create_session with NO transfer sub-invocation.
                let replay_args: SorobanVec<Val> = (
                    buyer.clone(),
                    seller.clone(),
                    asset.clone(),
                    500_i128,
                    50_u32,
                    r1.clone(),
                    k1.clone(),
                )
                    .into_val(&env);
                let replayed = client
                    .mock_auths(&[MockAuth {
                        address: &buyer,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "create_session",
                            args: replay_args.clone(),
                            sub_invokes: &[],
                        },
                    }])
                    .create_session(&buyer, &seller, &asset, &500, &50, &r1, &k1);
                assert_eq!(replayed, s_settle);
                assert_single_authorization(
                    &env,
                    &buyer,
                    contract_invocation(
                        &env,
                        &contract_id,
                        "create_session",
                        replay_args,
                        std::vec![],
                    ),
                );

                // 3. reduce_session_cap (buyer auth)
                let reduce_args: SorobanVec<Val> = (s_settle.clone(), 400_i128).into_val(&env);
                client
                    .mock_auths(&[MockAuth {
                        address: &buyer,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "reduce_session_cap",
                            args: reduce_args.clone(),
                            sub_invokes: &[],
                        },
                    }])
                    .reduce_session_cap(&s_settle, &400);
                assert_single_authorization(
                    &env,
                    &buyer,
                    contract_invocation(
                        &env,
                        &contract_id,
                        "reduce_session_cap",
                        reduce_args,
                        std::vec![],
                    ),
                );
                assert_eq!(token.balance(&buyer), 1_600);
                assert_eq!(token.balance(&contract_id), 400);

                // 4. extend_session_expiry (mutual buyer + seller auth)
                let extend_args: SorobanVec<Val> = (s_settle.clone(), 80_u32).into_val(&env);
                client
                    .mock_auths(&[
                        MockAuth {
                            address: &buyer,
                            invoke: &MockAuthInvoke {
                                contract: &contract_id,
                                fn_name: "extend_session_expiry",
                                args: extend_args.clone(),
                                sub_invokes: &[],
                            },
                        },
                        MockAuth {
                            address: &seller,
                            invoke: &MockAuthInvoke {
                                contract: &contract_id,
                                fn_name: "extend_session_expiry",
                                args: extend_args.clone(),
                                sub_invokes: &[],
                            },
                        },
                    ])
                    .extend_session_expiry(&s_settle, &80);
                assert_eq!(
                    env.auths(),
                    std::vec![
                        (
                            buyer.clone(),
                            contract_invocation(
                                &env,
                                &contract_id,
                                "extend_session_expiry",
                                extend_args.clone(),
                                std::vec![],
                            )
                        ),
                        (
                            seller.clone(),
                            contract_invocation(
                                &env,
                                &contract_id,
                                "extend_session_expiry",
                                extend_args,
                                std::vec![],
                            )
                        ),
                    ]
                );

                // 5. extend_ttl (permissionless, zero auths)
                env.set_auths(&[]);
                client.extend_ttl(&s_settle);
                assert!(env.auths().is_empty());

                // 6. settle (seller auth)
                let usage_hash = BytesN::from_array(&env, &[0x31; 32]);
                let settle_args: SorobanVec<Val> =
                    (s_settle.clone(), 150_i128, usage_hash.clone()).into_val(&env);
                client
                    .mock_auths(&[MockAuth {
                        address: &seller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "settle",
                            args: settle_args.clone(),
                            sub_invokes: &[],
                        },
                    }])
                    .settle(&s_settle, &150, &usage_hash);
                assert_single_authorization(
                    &env,
                    &seller,
                    contract_invocation(&env, &contract_id, "settle", settle_args, std::vec![]),
                );
                assert_eq!(token.balance(&seller), 150);
                assert_eq!(token.balance(&buyer), 1_850);

                // 7. cancel (buyer auth)
                let r2 = BytesN::from_array(&env, &[0x12; 32]);
                let k2 = BytesN::from_array(&env, &[0x22; 32]);
                let s_cancel = create_session_with_explicit_tree(
                    &env,
                    &client,
                    &contract_id,
                    &buyer,
                    &seller,
                    &asset,
                    300,
                    50,
                    &r2,
                    &k2,
                );
                let cancel_args: SorobanVec<Val> = (s_cancel.clone(),).into_val(&env);
                client
                    .mock_auths(&[MockAuth {
                        address: &buyer,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "cancel",
                            args: cancel_args.clone(),
                            sub_invokes: &[],
                        },
                    }])
                    .cancel(&s_cancel);
                assert_single_authorization(
                    &env,
                    &buyer,
                    contract_invocation(&env, &contract_id, "cancel", cancel_args, std::vec![]),
                );
                assert_eq!(client.get_session(&s_cancel).status, SessionStatus::Cancelled);

                // 8. reject (seller auth)
                let r3 = BytesN::from_array(&env, &[0x13; 32]);
                let k3 = BytesN::from_array(&env, &[0x23; 32]);
                let s_reject = create_session_with_explicit_tree(
                    &env,
                    &client,
                    &contract_id,
                    &buyer,
                    &seller,
                    &asset,
                    200,
                    50,
                    &r3,
                    &k3,
                );
                let reject_args: SorobanVec<Val> = (s_reject.clone(),).into_val(&env);
                client
                    .mock_auths(&[MockAuth {
                        address: &seller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "reject",
                            args: reject_args.clone(),
                            sub_invokes: &[],
                        },
                    }])
                    .reject(&s_reject);
                assert_single_authorization(
                    &env,
                    &seller,
                    contract_invocation(&env, &contract_id, "reject", reject_args, std::vec![]),
                );
                assert_eq!(client.get_session(&s_reject).status, SessionStatus::Rejected);

                // 9. recover_expired and recover_expired_batch (permissionless, zero auths)
                let r4 = BytesN::from_array(&env, &[0x14; 32]);
                let k4 = BytesN::from_array(&env, &[0x24; 32]);
                let s_exp1 = create_session_with_explicit_tree(
                    &env,
                    &client,
                    &contract_id,
                    &buyer,
                    &seller,
                    &asset,
                    100,
                    40,
                    &r4,
                    &k4,
                );
                let r5 = BytesN::from_array(&env, &[0x15; 32]);
                let k5 = BytesN::from_array(&env, &[0x25; 32]);
                let s_exp2 = create_session_with_explicit_tree(
                    &env,
                    &client,
                    &contract_id,
                    &buyer,
                    &seller,
                    &asset,
                    100,
                    40,
                    &r5,
                    &k5,
                );
                env.ledger().set_sequence_number(40);
                env.set_auths(&[]);
                client.recover_expired(&s_exp1);
                assert!(env.auths().is_empty());
                let batch = client.recover_expired_batch(&soroban_vec![&env, s_exp2.clone()]);
                assert!(env.auths().is_empty());
                assert_eq!(batch.get(0).unwrap().status, BatchRecoveryStatus::Recovered);
                assert_eq!(token.balance(&buyer), 1_850);
                assert_eq!(token.balance(&seller), 150);
                assert_eq!(token.balance(&contract_id), 0);
                assert_eq!(client.get_escrow_liability(&asset), 0);
            }
        }
    }
}

#[test]
fn auth_parity_matrix_account_and_contract_admin_mutations_and_rotations() {
    for initial_admin_kind in PRINCIPAL_KINDS {
        for next_admin_kind in PRINCIPAL_KINDS {
            let env = Env::default();
            let contract_id = env.register(UptoSessionContract, ());
            let client = UptoSessionContractClient::new(&env, &contract_id);
            let admin = make_principal(&env, initial_admin_kind);
            let next_admin = make_principal(&env, next_admin_kind);
            let surplus_recipient = make_principal(&env, next_admin_kind);
            let asset1 = create_test_asset(&env, &contract_id, 50);
            let asset2 = create_test_asset(&env, &admin, 1);
            let policies = soroban_vec![&env, default_policy(&asset1, 500)];

            let run_admin_call = |signer: &Address, fn_name: &str, args: SorobanVec<Val>| {
                env.set_auths(&[]);
                let _ = (signer, fn_name, args);
            };
            let _ = run_admin_call;

            // initialize
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "initialize",
                    (admin.clone(), policies.clone()).into_val(&env),
                )])
                .initialize(&admin, &policies);

            // set_asset_max_session_amount
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "set_asset_max_session_amount",
                    (asset1.clone(), 400_i128).into_val(&env),
                )])
                .set_asset_max_session_amount(&asset1, &400);
            assert_eq!(client.get_asset_max_session_amount(&asset1), 400);

            // propose_asset_cap_increase + cancel_asset_cap_increase
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "propose_asset_cap_increase",
                    (asset1.clone(), 600_i128, 100_u32, 300_u32).into_val(&env),
                )])
                .propose_asset_cap_increase(&asset1, &600, &100, &300);
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "cancel_asset_cap_increase",
                    (asset1.clone(),).into_val(&env),
                )])
                .cancel_asset_cap_increase(&asset1);

            // propose_asset_cap_increase + accept_asset_cap_increase
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "propose_asset_cap_increase",
                    (asset1.clone(), 600_i128, 100_u32, 300_u32).into_val(&env),
                )])
                .propose_asset_cap_increase(&asset1, &600, &100, &300);
            env.ledger().set_sequence_number(100);
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "accept_asset_cap_increase",
                    (asset1.clone(),).into_val(&env),
                )])
                .accept_asset_cap_increase(&asset1);
            assert_eq!(client.get_asset_max_session_amount(&asset1), 600);

            // exposure ceilings & session count limits
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "set_seller_exposure_ceiling",
                    (asset1.clone(), 1_000_i128).into_val(&env),
                )])
                .set_seller_exposure_ceiling(&asset1, &1_000);
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "set_asset_exposure_ceiling",
                    (asset1.clone(), 2_000_i128).into_val(&env),
                )])
                .set_asset_exposure_ceiling(&asset1, &2_000);
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "set_buyer_exposure_ceiling",
                    (asset1.clone(), 1_500_i128).into_val(&env),
                )])
                .set_buyer_exposure_ceiling(&asset1, &1_500);
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "set_max_buyer_open_sessions",
                    (4_u32,).into_val(&env),
                )])
                .set_max_buyer_open_sessions(&4);
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "set_max_seller_open_sessions",
                    (5_u32,).into_val(&env),
                )])
                .set_max_seller_open_sessions(&5);

            // activate_asset -> deprecate_asset -> remove_asset
            let asset2_policy = default_policy(&asset2, 300);
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "activate_asset",
                    (asset2_policy.clone(),).into_val(&env),
                )])
                .activate_asset(&asset2_policy);
            let reason = BytesN::from_array(&env, &[0x55; 32]);
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "deprecate_asset",
                    (asset2.clone(), reason.clone()).into_val(&env),
                )])
                .deprecate_asset(&asset2, &reason);
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "remove_asset",
                    (asset2.clone(), reason.clone()).into_val(&env),
                )])
                .remove_asset(&asset2, &reason);

            // pause_creation -> resume_creation
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "pause_creation",
                    ().into_val(&env),
                )])
                .pause_creation();
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "resume_creation",
                    ().into_val(&env),
                )])
                .resume_creation();

            // recover_surplus
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "recover_surplus",
                    (asset1.clone(), surplus_recipient.clone(), 50_i128).into_val(&env),
                )])
                .recover_surplus(&asset1, &surplus_recipient, &50);
            assert_eq!(token::Client::new(&env, &asset1).balance(&surplus_recipient), 50);

            // propose_admin -> cancel_admin_rotation -> propose_admin -> accept_admin
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "propose_admin",
                    (next_admin.clone(), 200_u32).into_val(&env),
                )])
                .propose_admin(&next_admin, &200);
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "cancel_admin_rotation",
                    ().into_val(&env),
                )])
                .cancel_admin_rotation();
            client
                .mock_auths(&[single_mock_auth!(
                    &admin,
                    &contract_id,
                    "propose_admin",
                    (next_admin.clone(), 200_u32).into_val(&env),
                )])
                .propose_admin(&next_admin, &200);
            client
                .mock_auths(&[single_mock_auth!(
                    &next_admin,
                    &contract_id,
                    "accept_admin",
                    ().into_val(&env),
                )])
                .accept_admin();
            assert_eq!(client.get_admin(), next_admin);
        }
    }
}

#[test]
fn nested_contract_principal_cross_contract_invocations_authorize_explicitly() {
    let env = Env::default();
    let escrow_id = env.register(UptoSessionContract, ());
    let escrow = UptoSessionContractClient::new(&env, &escrow_id);

    let admin_contract = env.register(ContractPrincipal, ());
    let buyer_contract = env.register(ContractPrincipal, ());
    let seller_contract = env.register(ContractPrincipal, ());
    let admin_client = ContractPrincipalClient::new(&env, &admin_contract);
    let buyer_client = ContractPrincipalClient::new(&env, &buyer_contract);
    let seller_client = ContractPrincipalClient::new(&env, &seller_contract);

    let asset = create_test_asset(&env, &buyer_contract, 1_500);
    let token = token::Client::new(&env, &asset);
    let policies = soroban_vec![&env, default_policy(&asset, 1_000)];

    // Cross-contract initialize: admin_contract is the invoker, so no external auth is needed.
    admin_client.initialize_escrow(&escrow_id, &policies);
    assert_eq!(escrow.get_admin(), admin_contract);

    // Cross-contract create_session: buyer_contract explicitly authorizes nested token::transfer.
    let r1 = BytesN::from_array(&env, &[0x61; 32]);
    let k1 = BytesN::from_array(&env, &[0x71; 32]);
    let s1 = buyer_client.open_session(&escrow_id, &seller_contract, &asset, &500, &60, &r1, &k1);
    assert_eq!(token.balance(&buyer_contract), 1_000);
    assert_eq!(token.balance(&escrow_id), 500);

    // Cross-contract reduce_session_cap by contract buyer.
    buyer_client.reduce_cap(&escrow_id, &s1, &400);
    assert_eq!(token.balance(&buyer_contract), 1_100);
    assert_eq!(token.balance(&escrow_id), 400);

    // Cross-contract settle by contract seller.
    let usage = BytesN::from_array(&env, &[0x81; 32]);
    seller_client.settle_session(&escrow_id, &s1, &250, &usage);
    assert_eq!(token.balance(&seller_contract), 250);
    assert_eq!(token.balance(&buyer_contract), 1_250);
    assert_eq!(token.balance(&escrow_id), 0);

    // Cross-contract cancel by contract buyer and reject by contract seller.
    let s2 = buyer_client.open_session(
        &escrow_id,
        &seller_contract,
        &asset,
        &300,
        &60,
        &BytesN::from_array(&env, &[0x62; 32]),
        &BytesN::from_array(&env, &[0x72; 32]),
    );
    buyer_client.cancel_session(&escrow_id, &s2);
    assert_eq!(escrow.get_session(&s2).status, SessionStatus::Cancelled);

    let s3 = buyer_client.open_session(
        &escrow_id,
        &seller_contract,
        &asset,
        &200,
        &60,
        &BytesN::from_array(&env, &[0x63; 32]),
        &BytesN::from_array(&env, &[0x73; 32]),
    );
    seller_client.reject_session(&escrow_id, &s3);
    assert_eq!(escrow.get_session(&s3).status, SessionStatus::Rejected);

    // Cross-contract pause and resume by contract admin.
    admin_client.pause_escrow(&escrow_id);
    assert_eq!(
        escrow.get_configuration().operational_state,
        OperationalState::Paused
    );
    admin_client.resume_escrow(&escrow_id);
    assert_eq!(
        escrow.get_configuration().operational_state,
        OperationalState::Active
    );
}

#[test]
fn auth_parity_failures_prove_zero_storage_or_token_movement_for_accounts_and_contracts() {
    for principal_kind in PRINCIPAL_KINDS {
        let env = Env::default();
        let contract_id = env.register(UptoSessionContract, ());
        let client = UptoSessionContractClient::new(&env, &contract_id);
        let admin = make_principal(&env, principal_kind);
        let buyer = make_principal(&env, principal_kind);
        let seller = make_principal(&env, principal_kind);
        let attacker = make_principal(&env, principal_kind);
        let asset = create_test_asset(&env, &buyer, 1_000);
        let token = token::Client::new(&env, &asset);
        let policies = soroban_vec![&env, default_policy(&asset, 500)];

        client
            .mock_auths(&[single_mock_auth!(
                &admin,
                &contract_id,
                "initialize",
                (admin.clone(), policies.clone()).into_val(&env),
            )])
            .initialize(&admin, &policies);

        // 1. Missing nested token::transfer sub-invocation in create_session must fail with no movement.
        let r_fail = BytesN::from_array(&env, &[0x91; 32]);
        let k_fail = BytesN::from_array(&env, &[0x92; 32]);
        let res_no_sub = client
            .mock_auths(&[single_mock_auth!(
                &buyer,
                &contract_id,
                "create_session",
                (
                    buyer.clone(),
                    seller.clone(),
                    asset.clone(),
                    400_i128,
                    50_u32,
                    r_fail.clone(),
                    k_fail.clone(),
                )
                    .into_val(&env),
            )])
            .try_create_session(&buyer, &seller, &asset, &400, &50, &r_fail, &k_fail);
        assert!(res_no_sub.is_err());
        assert_eq!(token.balance(&buyer), 1_000);
        assert_eq!(token.balance(&contract_id), 0);
        assert_eq!(client.get_escrow_liability(&asset), 0);
        assert_eq!(client.get_buyer_exposure(&buyer, &asset), 0);
        assert_eq!(client.get_seller_exposure(&seller, &asset), 0);
        assert_eq!(client.get_buyer_open_sessions(&buyer), 0);
        assert_eq!(client.get_seller_open_sessions(&seller), 0);
        assert_eq!(escrow_events_count(&env, &contract_id), 0);
        env.as_contract(&contract_id, || {
            assert_eq!(storage::read_next_session_sequence(&env), 0);
        });

        // Open a real session to test mutation failure atomicity.
        let session_id = create_session_with_explicit_tree(
            &env,
            &client,
            &contract_id,
            &buyer,
            &seller,
            &asset,
            400,
            50,
            &BytesN::from_array(&env, &[0x93; 32]),
            &BytesN::from_array(&env, &[0x94; 32]),
        );
        let session_before = client.get_session(&session_id);
        let config_before = client.get_configuration();
        let usage = BytesN::from_array(&env, &[0x95; 32]);

        // 2. Wrong-party / missing auth across settle, cancel, reject, reduce_session_cap,
        //    extend_session_expiry (only buyer OR only seller), and pause_creation.
        assert!(client
            .mock_auths(&[single_mock_auth!(
                &buyer,
                &contract_id,
                "settle",
                (session_id.clone(), 100_i128, usage.clone()).into_val(&env),
            )])
            .try_settle(&session_id, &100, &usage)
            .is_err());
        assert_eq!(escrow_events_count(&env, &contract_id), 0);

        assert!(client
            .mock_auths(&[single_mock_auth!(
                &seller,
                &contract_id,
                "cancel",
                (session_id.clone(),).into_val(&env),
            )])
            .try_cancel(&session_id)
            .is_err());
        assert_eq!(escrow_events_count(&env, &contract_id), 0);

        assert!(client
            .mock_auths(&[single_mock_auth!(
                &buyer,
                &contract_id,
                "reject",
                (session_id.clone(),).into_val(&env),
            )])
            .try_reject(&session_id)
            .is_err());
        assert_eq!(escrow_events_count(&env, &contract_id), 0);

        assert!(client
            .mock_auths(&[single_mock_auth!(
                &seller,
                &contract_id,
                "reduce_session_cap",
                (session_id.clone(), 200_i128).into_val(&env),
            )])
            .try_reduce_session_cap(&session_id, &200)
            .is_err());
        assert_eq!(escrow_events_count(&env, &contract_id), 0);

        // extend_session_expiry with only buyer auth must fail
        assert!(client
            .mock_auths(&[single_mock_auth!(
                &buyer,
                &contract_id,
                "extend_session_expiry",
                (session_id.clone(), 90_u32).into_val(&env),
            )])
            .try_extend_session_expiry(&session_id, &90)
            .is_err());
        assert_eq!(escrow_events_count(&env, &contract_id), 0);

        // extend_session_expiry with only seller auth must fail
        assert!(client
            .mock_auths(&[single_mock_auth!(
                &seller,
                &contract_id,
                "extend_session_expiry",
                (session_id.clone(), 90_u32).into_val(&env),
            )])
            .try_extend_session_expiry(&session_id, &90)
            .is_err());
        assert_eq!(escrow_events_count(&env, &contract_id), 0);

        // Admin mutation by attacker must fail
        assert!(client
            .mock_auths(&[single_mock_auth!(
                &attacker,
                &contract_id,
                "pause_creation",
                ().into_val(&env),
            )])
            .try_pause_creation()
            .is_err());
        assert_eq!(escrow_events_count(&env, &contract_id), 0);

        // Assert zero storage and zero token movement across all failed attempts.
        assert_eq!(client.get_session(&session_id), session_before);
        assert_eq!(client.get_configuration(), config_before);
        assert_eq!(token.balance(&buyer), 600);
        assert_eq!(token.balance(&seller), 0);
        assert_eq!(token.balance(&contract_id), 400);
        assert_eq!(client.get_escrow_liability(&asset), 400);
        assert_eq!(client.get_buyer_exposure(&buyer, &asset), 400);
        assert_eq!(client.get_seller_exposure(&seller, &asset), 400);
        assert_eq!(client.get_buyer_open_sessions(&buyer), 1);
        assert_eq!(client.get_seller_open_sessions(&seller), 1);
    }
}
