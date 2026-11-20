extern crate std;

use crate::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger as _, MockAuth,
        MockAuthInvoke,
    },
    token,
    xdr::{SorobanAuthorizationEntry, SorobanCredentials},
    Address, Env, IntoVal, Symbol, Val, Vec as SorobanVec,
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

pub fn auth_entry_with_expiration(
    mock: &MockAuth<'_>,
    expiration_ledger: u32,
) -> SorobanAuthorizationEntry {
    let mut entry: SorobanAuthorizationEntry = mock.into();
    if let SorobanCredentials::Address(ref mut creds) = entry.credentials {
        creds.signature_expiration_ledger = expiration_ledger;
    }
    entry
}

#[test]
fn auth_expiration_exact_boundary_protects_public_mutations() {
    let env = Env::default();
    let identities = TestIdentities::generate(&env);
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let asset = create_test_asset(&env, &identities.buyer, 10_000);
    let resource_hash = BytesN::from_array(&env, &[41; 32]);
    let usage_hash = BytesN::from_array(&env, &[42; 32]);
    let asset_policies = soroban_sdk::vec![
        &env,
        AssetPolicy {
            asset: asset.clone(),
            max_session_amount: 1_000,
            min_session_amount: 1,
            max_asset_exposure: 10_000,
            max_buyer_exposure: 10_000,
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

    let current_ledger = 100_u32;
    env.ledger().set_sequence_number(current_ledger);

    // 1. create_session boundary:
    let create_mock = MockAuth {
        address: &identities.buyer,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_session",
            args: (
                identities.buyer.clone(),
                identities.seller.clone(),
                asset.clone(),
                500_i128,
                200_u32,
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
    };

    // Expired auth (current_ledger - 1 = 99) fails and does not mutate balances or liability
    let buyer_balance_before = token::Client::new(&env, &asset).balance(&identities.buyer);
    let contract_balance_before = token::Client::new(&env, &asset).balance(&contract_id);
    env.mock_auths(core::slice::from_ref(&create_mock));
    env.set_auths(&[auth_entry_with_expiration(&create_mock, current_ledger - 1)]);
    let create_expired_res = client.try_create_session(
        &identities.buyer,
        &identities.seller,
        &asset,
        &500,
        &200,
        &resource_hash,
    );
    assert!(create_expired_res.is_err());
    assert_eq!(
        token::Client::new(&env, &asset).balance(&identities.buyer),
        buyer_balance_before
    );
    assert_eq!(
        token::Client::new(&env, &asset).balance(&contract_id),
        contract_balance_before
    );
    assert_eq!(client.get_escrow_liability(&asset), 0);

    // Last valid auth (current_ledger = 100) succeeds deterministically
    env.mock_auths(core::slice::from_ref(&create_mock));
    env.set_auths(&[auth_entry_with_expiration(&create_mock, current_ledger)]);
    let session_id = client
        .try_create_session(
            &identities.buyer,
            &identities.seller,
            &asset,
            &500,
            &200,
            &resource_hash,
        )
        .unwrap()
        .unwrap();
    assert_eq!(client.get_escrow_liability(&asset), 500);
    assert_eq!(
        token::Client::new(&env, &asset).balance(&contract_id),
        500
    );

    // 2. settle boundary:
    let settle_mock = MockAuth {
        address: &identities.seller,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "settle",
            args: (session_id.clone(), 150_i128, usage_hash.clone()).into_val(&env),
            sub_invokes: &[],
        },
    };

    // Expired auth at 99 fails without mutating session or balances
    env.mock_auths(core::slice::from_ref(&settle_mock));
    env.set_auths(&[auth_entry_with_expiration(&settle_mock, current_ledger - 1)]);
    let settle_expired_res = client.try_settle(&session_id, &150, &usage_hash);
    assert!(settle_expired_res.is_err());
    let session = client.get_session(&session_id);
    assert_eq!(session.status, SessionStatus::Open);
    assert_eq!(session.settled_amount, 0);
    assert_eq!(session.escrowed_amount, 500);
    assert_eq!(
        token::Client::new(&env, &asset).balance(&identities.seller),
        0
    );

    // 3. reduce_session_cap boundary:
    let reduce_mock = MockAuth {
        address: &identities.buyer,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "reduce_session_cap",
            args: (session_id.clone(), 400_i128).into_val(&env),
            sub_invokes: &[],
        },
    };
    // Expired auth fails
    env.mock_auths(core::slice::from_ref(&reduce_mock));
    env.set_auths(&[auth_entry_with_expiration(&reduce_mock, current_ledger - 1)]);
    assert!(client.try_reduce_session_cap(&session_id, &400).is_err());
    assert_eq!(client.get_session(&session_id).max_amount, 500);

    // Last valid auth at current_ledger succeeds
    env.mock_auths(core::slice::from_ref(&reduce_mock));
    env.set_auths(&[auth_entry_with_expiration(&reduce_mock, current_ledger)]);
    assert!(client.try_reduce_session_cap(&session_id, &400).unwrap().is_ok());
    assert_eq!(client.get_session(&session_id).max_amount, 400);

    // 4. extend_session_expiry boundary (requires both buyer and seller auth):
    let extend_buyer_mock = MockAuth {
        address: &identities.buyer,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "extend_session_expiry",
            args: (session_id.clone(), 250_u32).into_val(&env),
            sub_invokes: &[],
        },
    };
    let extend_seller_mock = MockAuth {
        address: &identities.seller,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "extend_session_expiry",
            args: (session_id.clone(), 250_u32).into_val(&env),
            sub_invokes: &[],
        },
    };
    // Either party having expired auth fails closed
    env.mock_auths(&[extend_buyer_mock.clone(), extend_seller_mock.clone()]);
    env.set_auths(&[
        auth_entry_with_expiration(&extend_buyer_mock, current_ledger - 1),
        auth_entry_with_expiration(&extend_seller_mock, current_ledger),
    ]);
    assert!(client.try_extend_session_expiry(&session_id, &250).is_err());
    assert_eq!(client.get_session(&session_id).expires_at_ledger, 200);

    env.mock_auths(&[extend_buyer_mock.clone(), extend_seller_mock.clone()]);
    env.set_auths(&[
        auth_entry_with_expiration(&extend_buyer_mock, current_ledger),
        auth_entry_with_expiration(&extend_seller_mock, current_ledger - 1),
    ]);
    assert!(client.try_extend_session_expiry(&session_id, &250).is_err());
    assert_eq!(client.get_session(&session_id).expires_at_ledger, 200);

    // Both with last valid auth succeed
    env.mock_auths(&[extend_buyer_mock.clone(), extend_seller_mock.clone()]);
    env.set_auths(&[
        auth_entry_with_expiration(&extend_buyer_mock, current_ledger),
        auth_entry_with_expiration(&extend_seller_mock, current_ledger),
    ]);
    assert!(client.try_extend_session_expiry(&session_id, &250).unwrap().is_ok());
    assert_eq!(client.get_session(&session_id).expires_at_ledger, 250);

    // 5. cancel boundary:
    let cancel_mock = MockAuth {
        address: &identities.buyer,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "cancel",
            args: (session_id.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    };
    // Expired auth fails
    env.mock_auths(core::slice::from_ref(&cancel_mock));
    env.set_auths(&[auth_entry_with_expiration(&cancel_mock, current_ledger - 1)]);
    assert!(client.try_cancel(&session_id).is_err());
    assert_eq!(client.get_session(&session_id).status, SessionStatus::Open);

    // Last valid auth succeeds and finalizes session
    env.mock_auths(core::slice::from_ref(&cancel_mock));
    env.set_auths(&[auth_entry_with_expiration(&cancel_mock, current_ledger)]);
    assert!(client.try_cancel(&session_id).unwrap().is_ok());
    assert_eq!(client.get_session(&session_id).status, SessionStatus::Cancelled);
    assert_eq!(client.get_escrow_liability(&asset), 0);
}

#[test]
fn auth_expiration_distinguishes_authorization_failure_from_session_expiry() {
    let env = Env::default();
    let identities = TestIdentities::generate(&env);
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let asset = create_test_asset(&env, &identities.buyer, 5_000);
    let resource_hash = BytesN::from_array(&env, &[51; 32]);
    let usage_hash = BytesN::from_array(&env, &[52; 32]);
    let asset_policies = soroban_sdk::vec![
        &env,
        AssetPolicy {
            asset: asset.clone(),
            max_session_amount: 1_000,
            min_session_amount: 1,
            max_asset_exposure: 5_000,
            max_buyer_exposure: 5_000,
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

    let session_expiry_ledger = 300_u32;
    env.ledger().set_sequence_number(100);

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
                    session_expiry_ledger,
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
            &session_expiry_ledger,
            &resource_hash,
        );

    // Case 1: Before session expiry (ledger 200 < 300), auth is expired (exp 150 < 200).
    // Result is an authorization failure (host error), NOT ContractError::ExpiredSession.
    env.ledger().set_sequence_number(200);
    let settle_mock = MockAuth {
        address: &identities.seller,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "settle",
            args: (session_id.clone(), 200_i128, usage_hash.clone()).into_val(&env),
            sub_invokes: &[],
        },
    };
    env.mock_auths(core::slice::from_ref(&settle_mock));
    env.set_auths(&[auth_entry_with_expiration(&settle_mock, 150)]);
    let err_unauthorized = client.try_settle(&session_id, &200, &usage_hash);
    // Unauthorized produces invoke/host failure, not ContractError::ExpiredSession
    assert!(err_unauthorized.is_err());
    assert_ne!(
        err_unauthorized,
        Err(Ok(ContractError::ExpiredSession))
    );
    assert_eq!(client.get_session(&session_id).status, SessionStatus::Open);

    // Case 2: At/past session expiry (ledger 300 >= 300), auth is VALID (exp 400 > 300).
    // Result is strictly ContractError::ExpiredSession, proving distinction.
    env.ledger().set_sequence_number(300);
    env.mock_auths(core::slice::from_ref(&settle_mock));
    env.set_auths(&[auth_entry_with_expiration(&settle_mock, 400)]);
    let err_session_expired = client.try_settle(&session_id, &200, &usage_hash);
    assert_eq!(
        err_session_expired,
        Err(Ok(ContractError::ExpiredSession))
    );
    assert_eq!(client.get_session(&session_id).status, SessionStatus::Open);

    // Cancel exhibits identical distinction:
    let cancel_mock = MockAuth {
        address: &identities.buyer,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "cancel",
            args: (session_id.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    };
    env.mock_auths(core::slice::from_ref(&cancel_mock));
    env.set_auths(&[auth_entry_with_expiration(&cancel_mock, 400)]);
    assert_eq!(
        client.try_cancel(&session_id),
        Err(Ok(ContractError::ExpiredSession))
    );
}

#[test]
fn auth_expiration_upper_boundary_and_overflow_adjacent_limits_are_enforced() {
    let env = Env::default();
    let identities = TestIdentities::generate(&env);
    let contract_id = env.register(EscrowAuthorizationHarness, ());
    let client = EscrowAuthorizationHarnessClient::new(&env, &contract_id);
    let asset = create_test_asset(&env, &identities.buyer, 1_000);

    let curr_ledger = 500_u32;
    env.ledger().set_sequence_number(curr_ledger);
    let max_ttl = env.storage().max_ttl();
    let max_valid_exp = curr_ledger + max_ttl;

    let mock = MockAuth {
        address: &identities.buyer,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "fund",
            args: (identities.buyer.clone(), asset.clone(), 50_i128).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &asset,
                fn_name: "transfer",
                args: (identities.buyer.clone(), contract_id.clone(), 50_i128).into_val(&env),
                sub_invokes: &[],
            }],
        },
    };

    // Upper boundary: max_valid_exp succeeds deterministically
    env.mock_auths(core::slice::from_ref(&mock));
    let entry_max_valid = auth_entry_with_expiration(&mock, max_valid_exp);
    env.set_auths(&[entry_max_valid]);
    assert!(client.try_fund(&identities.buyer, &asset, &50).is_ok());

    // Exceeding upper boundary (overflow-adjacent: max_valid_exp + 1) fails closed
    env.mock_auths(core::slice::from_ref(&mock));
    let entry_exceeded = auth_entry_with_expiration(&mock, max_valid_exp + 1);
    env.set_auths(&[entry_exceeded]);
    assert!(client.try_fund(&identities.buyer, &asset, &50).is_err());

    // u32::MAX fails closed
    env.mock_auths(core::slice::from_ref(&mock));
    let entry_max = auth_entry_with_expiration(&mock, u32::MAX);
    env.set_auths(&[entry_max]);
    assert!(client.try_fund(&identities.buyer, &asset, &50).is_err());
}
