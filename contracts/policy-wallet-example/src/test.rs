extern crate std;

mod mutation_harness {
    include!("mutation_test.rs");
}

mod property_harness {
    include!("property_test.rs");
}

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    vec, Address, BytesN, Env, Event,
};
use upto_session::{AssetPolicy, ContractError, UptoSessionContract, UptoSessionContractClient};

fn initialized_wallet(
    env: &Env,
) -> (
    PolicyWalletExampleContractClient<'_>,
    Address,
    Address,
    Address,
    Address,
    BytesN<32>,
) {
    let contract_id = env.register(PolicyWalletExampleContract, ());
    let client = PolicyWalletExampleContractClient::new(env, &contract_id);
    let owner = Address::generate(env);
    let agent = Address::generate(env);
    let seller = Address::generate(env);
    let asset = Address::generate(env);
    let resource_hash = BytesN::from_array(env, &[12; 32]);

    client.initialize(&owner, &Address::generate(env));

    (client, agent, seller, asset, owner, resource_hash)
}

fn set_standard_policy(
    env: &Env,
    client: &PolicyWalletExampleContractClient<'_>,
    agent: &Address,
    seller: &Address,
    asset: &Address,
    resource_hash: &BytesN<32>,
) {
    let expected_revision = env.as_contract(&client.address, || {
        env.storage()
            .instance()
            .get::<_, SpendingPolicy>(&DataKey::Policy(agent.clone()))
            .map(|existing| existing.revision)
            .unwrap_or(0)
    });
    client.set_policy(
        &standard_policy(env, agent, seller, asset, resource_hash, 100),
        &expected_revision,
    );
}

fn standard_policy(
    env: &Env,
    agent: &Address,
    seller: &Address,
    asset: &Address,
    resource_hash: &BytesN<32>,
    valid_until_ledger: u32,
) -> SpendingPolicy {
    SpendingPolicy {
        agent: agent.clone(),
        max_amount_per_payment: 75,
        max_amount_per_day: 100,
        max_authorizations_per_day: 100,
        valid_from_ledger: 0,
        valid_until_ledger,
        allowed_sellers: vec![env, seller.clone()],
        allowed_assets: vec![env, asset.clone()],
        allowed_resource_hashes: vec![env, resource_hash.clone()],
        seller_limits: vec![env],
        asset_limits: vec![
            env,
            AssetSpendingLimit {
                asset: asset.clone(),
                max_amount_per_payment: 75,
                max_amount_per_day: 100,
            },
        ],
        resource_limits: vec![env],
        revision: 0,
    }
}

#[test]
fn policy_wallet_example_is_registered_independently() {
    let env = Env::default();
    let contract_id = env.register(PolicyWalletExampleContract, ());
    let client = PolicyWalletExampleContractClient::new(&env, &contract_id);

    assert!(client.example_only());
}

#[test]
fn initializes_config_once_with_owner_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PolicyWalletExampleContract, ());
    let client = PolicyWalletExampleContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let upto_session_contract = Address::generate(&env);

    client.initialize(&owner, &upto_session_contract);

    let config = client.get_config();
    assert_eq!(config.owner, owner);
    assert_eq!(config.upto_session_contract, upto_session_contract);
    assert_eq!(config.initialized_at_ledger, env.ledger().sequence());
    assert!(config.example_only);
    assert_eq!(
        client.try_initialize(&owner, &upto_session_contract),
        Err(Ok(PolicyWalletError::AlreadyInitialized))
    );
}

#[test]
fn initialize_requires_owner_auth() {
    let env = Env::default();
    let contract_id = env.register(PolicyWalletExampleContract, ());
    let client = PolicyWalletExampleContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let upto_session_contract = Address::generate(&env);

    assert!(client
        .try_initialize(&owner, &upto_session_contract)
        .is_err());
    assert_eq!(
        client.try_get_config(),
        Err(Ok(PolicyWalletError::NotInitialized))
    );
}

#[test]
fn require_owner_uses_stored_owner_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PolicyWalletExampleContract, ());
    let client = PolicyWalletExampleContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let upto_session_contract = Address::generate(&env);

    client.initialize(&owner, &upto_session_contract);

    assert!(client.try_require_owner().is_ok());
}

#[test]
fn policy_wallet_storage_is_isolated_from_upto_session() {
    let env = Env::default();
    env.mock_all_auths();
    let wallet_id = env.register(PolicyWalletExampleContract, ());
    let wallet_client = PolicyWalletExampleContractClient::new(&env, &wallet_id);
    let upto_session_id = env.register(UptoSessionContract, ());
    let upto_client = UptoSessionContractClient::new(&env, &upto_session_id);
    let owner = Address::generate(&env);
    let asset = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let missing_session_id = BytesN::from_array(&env, &[9; 32]);

    wallet_client.initialize(&owner, &upto_session_id);

    assert_eq!(
        upto_client.try_get_session(&missing_session_id),
        Err(Ok(ContractError::SessionNotFound))
    );
    assert!(upto_client
        .try_initialize(
            &owner,
            &soroban_sdk::vec![
                &env,
                AssetPolicy {
                    asset,
                    max_session_amount: 1,
                    min_session_amount: 1,
                    max_asset_exposure: 1,
                    max_buyer_exposure: 1,
                }
            ]
        )
        .is_ok());
}

#[test]
fn owner_sets_spending_policy() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);

    set_standard_policy(&env, &client, &agent, &seller, &asset, &resource_hash);

    let policy = client.get_policy(&agent);
    assert_eq!(policy.agent, agent);
    assert_eq!(policy.max_amount_per_payment, 75);
    assert_eq!(policy.max_amount_per_day, 100);
    assert_eq!(policy.valid_until_ledger, 100);
    assert_eq!(policy.allowed_sellers, vec![&env, seller]);
    assert_eq!(policy.allowed_assets, vec![&env, asset]);
    assert_eq!(policy.allowed_resource_hashes, vec![&env, resource_hash]);
}

#[test]
fn check_payment_accepts_policy_match_without_recording_spend() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    set_standard_policy(&env, &client, &agent, &seller, &asset, &resource_hash);

    assert!(client
        .try_check_payment(&agent, &seller, &asset, &50, &resource_hash)
        .is_ok());
    assert_eq!(client.spent_today(&agent), 0);
}

#[test]
fn authorize_payment_records_daily_spend() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    set_standard_policy(&env, &client, &agent, &seller, &asset, &resource_hash);

    client.authorize_payment(&agent, &seller, &asset, &60, &resource_hash);
    client.authorize_payment(&agent, &seller, &asset, &40, &resource_hash);

    assert_eq!(client.spent_today(&agent), 100);
}

#[test]
fn rejects_amounts_over_payment_or_daily_caps() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    set_standard_policy(&env, &client, &agent, &seller, &asset, &resource_hash);

    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &76, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsPaymentCap))
    );

    client.authorize_payment(&agent, &seller, &asset, &75, &resource_hash);
    assert_eq!(
        client.try_authorize_payment(&agent, &seller, &asset, &26, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsDailyCap))
    );
}

#[test]
fn rejects_disallowed_seller_asset_or_resource_hash() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    let wrong_seller = Address::generate(&env);
    let wrong_asset = Address::generate(&env);
    let wrong_resource_hash = BytesN::from_array(&env, &[13; 32]);
    set_standard_policy(&env, &client, &agent, &seller, &asset, &resource_hash);

    assert_eq!(
        client.try_check_payment(&agent, &wrong_seller, &asset, &50, &resource_hash),
        Err(Ok(PolicyWalletError::SellerNotAllowed))
    );
    assert_eq!(
        client.try_check_payment(&agent, &seller, &wrong_asset, &50, &resource_hash),
        Err(Ok(PolicyWalletError::AssetNotAllowed))
    );
    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &50, &wrong_resource_hash),
        Err(Ok(PolicyWalletError::ResourceHashNotAllowed))
    );
}

#[test]
fn rejects_invalid_or_expired_policy_windows() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);

    assert_eq!(
        client.try_set_policy(
            &SpendingPolicy {
                agent: agent.clone(),
                max_amount_per_payment: 0,
                max_amount_per_day: 100,
                max_authorizations_per_day: 10,
                valid_from_ledger: 0,
                valid_until_ledger: 100,
                allowed_sellers: vec![&env, seller.clone()],
                allowed_assets: vec![&env, asset.clone()],
                allowed_resource_hashes: vec![&env, resource_hash.clone()],
                seller_limits: vec![&env],
                asset_limits: vec![
                    &env,
                    AssetSpendingLimit {
                        asset: asset.clone(),
                        max_amount_per_payment: 10,
                        max_amount_per_day: 100,
                    },
                ],
                resource_limits: vec![&env],
                revision: 0,
            },
            &0,
        ),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );
    assert_eq!(
        client.try_set_policy(
            &SpendingPolicy {
                agent: agent.clone(),
                max_amount_per_payment: 10,
                max_amount_per_day: 100,
                max_authorizations_per_day: 0,
                valid_from_ledger: 0,
                valid_until_ledger: 100,
                allowed_sellers: vec![&env, seller.clone()],
                allowed_assets: vec![&env, asset.clone()],
                allowed_resource_hashes: vec![&env, resource_hash.clone()],
                seller_limits: vec![&env],
                asset_limits: vec![
                    &env,
                    AssetSpendingLimit {
                        asset: asset.clone(),
                        max_amount_per_payment: 10,
                        max_amount_per_day: 100,
                    },
                ],
                resource_limits: vec![&env],
                revision: 0,
            },
            &0,
        ),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );
    assert_eq!(
        client.try_set_policy(
            &SpendingPolicy {
                agent: agent.clone(),
                max_amount_per_payment: 10,
                max_amount_per_day: 100,
                max_authorizations_per_day: 10,
                valid_from_ledger: 101,
                valid_until_ledger: 100,
                allowed_sellers: vec![&env, seller.clone()],
                allowed_assets: vec![&env, asset.clone()],
                allowed_resource_hashes: vec![&env, resource_hash.clone()],
                seller_limits: vec![&env],
                asset_limits: vec![
                    &env,
                    AssetSpendingLimit {
                        asset: asset.clone(),
                        max_amount_per_payment: 10,
                        max_amount_per_day: 100,
                    },
                ],
                resource_limits: vec![&env],
                revision: 0,
            },
            &0,
        ),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );
    assert_eq!(
        client.try_set_policy(
            &SpendingPolicy {
                agent,
                max_amount_per_payment: 10,
                max_amount_per_day: 100,
                max_authorizations_per_day: 10,
                valid_from_ledger: 0,
                valid_until_ledger: 0,
                allowed_sellers: vec![&env, seller],
                allowed_assets: vec![&env, asset.clone()],
                allowed_resource_hashes: vec![&env, resource_hash],
                seller_limits: vec![&env],
                asset_limits: vec![
                    &env,
                    AssetSpendingLimit {
                        asset,
                        max_amount_per_payment: 10,
                        max_amount_per_day: 100,
                    },
                ],
                resource_limits: vec![&env],
                revision: 0,
            },
            &0,
        ),
        Err(Ok(PolicyWalletError::PolicyExpired))
    );
}

#[test]
fn documentation_pre_activation_policy_example_reports_not_active() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    let mut policy = standard_policy(&env, &agent, &seller, &asset, &resource_hash, 100);
    policy.valid_from_ledger = 50;
    client.set_policy(&policy, &0);

    env.ledger().set_sequence_number(49);

    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &50, &resource_hash),
        Err(Ok(PolicyWalletError::PolicyNotActive))
    );
    assert_eq!(
        client.try_authorize_payment(&agent, &seller, &asset, &50, &resource_hash),
        Err(Ok(PolicyWalletError::PolicyNotActive))
    );
    assert_eq!(client.spent_today(&agent), 0);
}

#[test]
fn pre_activation_and_u32_boundary_checks() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);

    // 1. Invalid range where valid_from_ledger > valid_until_ledger
    let mut invalid_policy = standard_policy(&env, &agent, &seller, &asset, &resource_hash, 50);
    invalid_policy.valid_from_ledger = 51;
    assert_eq!(
        client.try_set_policy(&invalid_policy, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    // 2. Single-ledger valid window where valid_from_ledger == valid_until_ledger
    let mut single_ledger_policy =
        standard_policy(&env, &agent, &seller, &asset, &resource_hash, 100);
    single_ledger_policy.valid_from_ledger = 100;
    client.set_policy(&single_ledger_policy, &0);

    // Before activation
    env.ledger().set_sequence_number(99);
    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &50, &resource_hash),
        Err(Ok(PolicyWalletError::PolicyNotActive))
    );

    // Exactly at valid_from_ledger == valid_until_ledger (inclusive on both ends)
    env.ledger().set_sequence_number(100);
    assert!(client
        .try_authorize_payment(&agent, &seller, &asset, &50, &resource_hash)
        .is_ok());
    assert_eq!(client.spent_today(&agent), 50);

    // After expiration
    env.ledger().set_sequence_number(101);
    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &50, &resource_hash),
        Err(Ok(PolicyWalletError::PolicyExpired))
    );

    // 3. u32 boundary values: 0 and u32::MAX
    let mut max_u32_policy =
        standard_policy(&env, &agent, &seller, &asset, &resource_hash, u32::MAX);
    max_u32_policy.valid_from_ledger = 0;
    client.set_policy(&max_u32_policy, &1);

    env.ledger().set_sequence_number(500);
    assert!(client
        .try_check_payment(&agent, &seller, &asset, &50, &resource_hash)
        .is_ok());

    // Policy with valid_from_ledger at u32::MAX
    let mut future_max_policy =
        standard_policy(&env, &agent, &seller, &asset, &resource_hash, u32::MAX);
    future_max_policy.valid_from_ledger = u32::MAX;
    client.set_policy(&future_max_policy, &2);

    // Current sequence is 500, far below u32::MAX
    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &50, &resource_hash),
        Err(Ok(PolicyWalletError::PolicyNotActive))
    );
}

#[test]
fn documentation_allowed_payment_example_authorizes() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    set_standard_policy(&env, &client, &agent, &seller, &asset, &resource_hash);

    assert!(client
        .try_authorize_payment(&agent, &seller, &asset, &50, &resource_hash)
        .is_ok());
    assert_eq!(client.spent_today(&agent), 50);
}

#[test]
fn documentation_blocked_payment_example_reports_amount_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    set_standard_policy(&env, &client, &agent, &seller, &asset, &resource_hash);

    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &76, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsPaymentCap))
    );
}

#[test]
fn documentation_expired_policy_example_reports_expired() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    client.set_policy(
        &standard_policy(&env, &agent, &seller, &asset, &resource_hash, 10),
        &0,
    );

    env.ledger().set_sequence_number(11);

    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &50, &resource_hash),
        Err(Ok(PolicyWalletError::PolicyExpired))
    );
}

#[test]
fn documentation_wrong_seller_example_reports_seller_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    let wrong_seller = Address::generate(&env);
    set_standard_policy(&env, &client, &agent, &seller, &asset, &resource_hash);

    assert_eq!(
        client.try_check_payment(&agent, &wrong_seller, &asset, &50, &resource_hash),
        Err(Ok(PolicyWalletError::SellerNotAllowed))
    );
}

#[test]
fn documentation_wrong_asset_example_reports_asset_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    let wrong_asset = Address::generate(&env);
    set_standard_policy(&env, &client, &agent, &seller, &asset, &resource_hash);

    assert_eq!(
        client.try_check_payment(&agent, &seller, &wrong_asset, &50, &resource_hash),
        Err(Ok(PolicyWalletError::AssetNotAllowed))
    );
}

#[test]
fn documentation_seller_payment_cap_example_reports_amount_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    let mut policy = standard_policy(&env, &agent, &seller, &asset, &resource_hash, 100);
    policy.seller_limits = vec![
        &env,
        SellerSpendingLimit {
            seller: seller.clone(),
            max_amount_per_payment: 30,
            max_amount_per_day: 50,
        },
    ];
    client.set_policy(&policy, &0);

    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &35, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsPaymentCap))
    );
}

#[test]
fn documentation_seller_daily_cap_example_reports_daily_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller_a, asset, _owner, resource_hash) = initialized_wallet(&env);
    let seller_b = Address::generate(&env);

    let mut policy = standard_policy(&env, &agent, &seller_a, &asset, &resource_hash, 100);
    policy.allowed_sellers = vec![&env, seller_a.clone(), seller_b.clone()];
    policy.seller_limits = vec![
        &env,
        SellerSpendingLimit {
            seller: seller_a.clone(),
            max_amount_per_payment: 30,
            max_amount_per_day: 50,
        },
    ];
    client.set_policy(&policy, &0);

    // Spend 30 then 20 with seller A -> exactly reaches seller A's daily cap of 50
    client.authorize_payment(&agent, &seller_a, &asset, &30, &resource_hash);
    client.authorize_payment(&agent, &seller_a, &asset, &20, &resource_hash);
    assert_eq!(client.spent_today_seller(&agent, &seller_a), 50);

    // Further spend with seller A is rejected by seller daily cap
    assert_eq!(
        client.try_authorize_payment(&agent, &seller_a, &asset, &10, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsDailyCap))
    );

    // But seller B spend is isolated and succeeds up to global daily cap (100 - 50 = 50 remaining)
    assert!(client
        .try_authorize_payment(&agent, &seller_b, &asset, &30, &resource_hash)
        .is_ok());
    assert_eq!(client.spent_today_seller(&agent, &seller_b), 30);
    assert_eq!(client.spent_today(&agent), 80);
}

#[test]
fn per_seller_spending_ceilings_and_isolation() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller_a, asset, _owner, resource_hash) = initialized_wallet(&env);
    let seller_b = Address::generate(&env);
    let unknown_seller = Address::generate(&env);

    // 1. Seller ceiling cannot exceed global payment cap
    let mut invalid_policy = standard_policy(&env, &agent, &seller_a, &asset, &resource_hash, 100);
    invalid_policy.seller_limits = vec![
        &env,
        SellerSpendingLimit {
            seller: seller_a.clone(),
            max_amount_per_payment: 80, // > global 75
            max_amount_per_day: 90,
        },
    ];
    assert_eq!(
        client.try_set_policy(&invalid_policy, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    // 2. Seller ceiling cannot exceed global daily cap
    let mut invalid_policy2 = standard_policy(&env, &agent, &seller_a, &asset, &resource_hash, 100);
    invalid_policy2.seller_limits = vec![
        &env,
        SellerSpendingLimit {
            seller: seller_a.clone(),
            max_amount_per_payment: 50,
            max_amount_per_day: 150, // > global 100
        },
    ];
    assert_eq!(
        client.try_set_policy(&invalid_policy2, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    // 3. Unknown seller in seller_limits (not in allowed_sellers)
    let mut invalid_policy3 = standard_policy(&env, &agent, &seller_a, &asset, &resource_hash, 100);
    invalid_policy3.seller_limits = vec![
        &env,
        SellerSpendingLimit {
            seller: unknown_seller,
            max_amount_per_payment: 50,
            max_amount_per_day: 50,
        },
    ];
    assert_eq!(
        client.try_set_policy(&invalid_policy3, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    // 4. Duplicate seller in seller_limits
    let mut invalid_policy4 = standard_policy(&env, &agent, &seller_a, &asset, &resource_hash, 100);
    invalid_policy4.seller_limits = vec![
        &env,
        SellerSpendingLimit {
            seller: seller_a.clone(),
            max_amount_per_payment: 30,
            max_amount_per_day: 50,
        },
        SellerSpendingLimit {
            seller: seller_a.clone(),
            max_amount_per_payment: 20,
            max_amount_per_day: 40,
        },
    ];
    assert_eq!(
        client.try_set_policy(&invalid_policy4, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    // 5. Valid policy with seller A and B ceilings
    let mut valid_policy =
        standard_policy(&env, &agent, &seller_a, &asset, &resource_hash, 100_000);
    valid_policy.allowed_sellers = vec![&env, seller_a.clone(), seller_b.clone()];
    valid_policy.seller_limits = vec![
        &env,
        SellerSpendingLimit {
            seller: seller_a.clone(),
            max_amount_per_payment: 30,
            max_amount_per_day: 50,
        },
        SellerSpendingLimit {
            seller: seller_b.clone(),
            max_amount_per_payment: 40,
            max_amount_per_day: 60,
        },
    ];
    client.set_policy(&valid_policy, &0);

    // Exact per-payment boundary for seller A
    assert!(client
        .try_check_payment(&agent, &seller_a, &asset, &30, &resource_hash)
        .is_ok());
    assert_eq!(
        client.try_check_payment(&agent, &seller_a, &asset, &31, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsPaymentCap))
    );

    // Authorize payments to exact daily boundary for seller A
    client.authorize_payment(&agent, &seller_a, &asset, &30, &resource_hash);
    client.authorize_payment(&agent, &seller_a, &asset, &20, &resource_hash);
    assert_eq!(client.spent_today_seller(&agent, &seller_a), 50);
    assert_eq!(client.spent_today_seller(&agent, &seller_b), 0);

    // Over seller daily boundary fails
    assert_eq!(
        client.try_authorize_payment(&agent, &seller_a, &asset, &1, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsDailyCap))
    );

    // Spend isolation: seller B can spend up to its daily limit
    client.authorize_payment(&agent, &seller_b, &asset, &40, &resource_hash);
    assert_eq!(client.spent_today_seller(&agent, &seller_b), 40);
    assert_eq!(client.spent_today(&agent), 90);

    // 6. Day rollover resets daily spends
    env.ledger().set_sequence_number(LEDGERS_PER_DAY + 10);
    assert_eq!(client.spent_today_seller(&agent, &seller_a), 0);
    assert_eq!(client.spent_today_seller(&agent, &seller_b), 0);
    assert_eq!(client.spent_today(&agent), 0);

    // Can authorize again on the new day
    assert!(client
        .try_authorize_payment(&agent, &seller_a, &asset, &30, &resource_hash)
        .is_ok());
    assert_eq!(client.spent_today_seller(&agent, &seller_a), 30);
}

#[test]
fn documentation_resource_payment_cap_example_reports_amount_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    let mut policy = standard_policy(&env, &agent, &seller, &asset, &resource_hash, 100);
    policy.resource_limits = vec![
        &env,
        ResourceSpendingLimit {
            resource_hash: resource_hash.clone(),
            max_amount_per_payment: 25,
            max_amount_per_day: 40,
        },
    ];
    client.set_policy(&policy, &0);

    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &30, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsPaymentCap))
    );
}

#[test]
fn documentation_resource_daily_cap_example_reports_daily_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_a) = initialized_wallet(&env);
    let resource_b = BytesN::from_array(&env, &[99; 32]);

    let mut policy = standard_policy(&env, &agent, &seller, &asset, &resource_a, 100);
    policy.allowed_resource_hashes = vec![&env, resource_a.clone(), resource_b.clone()];
    policy.resource_limits = vec![
        &env,
        ResourceSpendingLimit {
            resource_hash: resource_a.clone(),
            max_amount_per_payment: 25,
            max_amount_per_day: 40,
        },
    ];
    client.set_policy(&policy, &0);

    // Spend 25 then 15 on resource A -> exactly reaches 40 daily limit
    client.authorize_payment(&agent, &seller, &asset, &25, &resource_a);
    client.authorize_payment(&agent, &seller, &asset, &15, &resource_a);
    assert_eq!(client.spent_today_resource(&agent, &resource_a), 40);

    // Further spend on resource A is rejected
    assert_eq!(
        client.try_authorize_payment(&agent, &seller, &asset, &5, &resource_a),
        Err(Ok(PolicyWalletError::AmountExceedsDailyCap))
    );

    // Resource B spend is isolated and succeeds up to global daily cap
    assert!(client
        .try_authorize_payment(&agent, &seller, &asset, &30, &resource_b)
        .is_ok());
    assert_eq!(client.spent_today_resource(&agent, &resource_b), 30);
    assert_eq!(client.spent_today(&agent), 70);
}

#[test]
fn per_resource_spending_ceilings_isolation_and_replacement() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_a) = initialized_wallet(&env);
    let resource_b = BytesN::from_array(&env, &[99; 32]);
    let unknown_resource = BytesN::from_array(&env, &[77; 32]);

    // 1. Resource ceiling cannot exceed global payment cap
    let mut invalid_policy = standard_policy(&env, &agent, &seller, &asset, &resource_a, 100);
    invalid_policy.resource_limits = vec![
        &env,
        ResourceSpendingLimit {
            resource_hash: resource_a.clone(),
            max_amount_per_payment: 80, // > 75
            max_amount_per_day: 90,
        },
    ];
    assert_eq!(
        client.try_set_policy(&invalid_policy, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    // 2. Resource ceiling cannot exceed global daily cap
    let mut invalid_policy2 = standard_policy(&env, &agent, &seller, &asset, &resource_a, 100);
    invalid_policy2.resource_limits = vec![
        &env,
        ResourceSpendingLimit {
            resource_hash: resource_a.clone(),
            max_amount_per_payment: 50,
            max_amount_per_day: 120, // > 100
        },
    ];
    assert_eq!(
        client.try_set_policy(&invalid_policy2, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    // 3. Unknown resource in resource_limits
    let mut invalid_policy3 = standard_policy(&env, &agent, &seller, &asset, &resource_a, 100);
    invalid_policy3.resource_limits = vec![
        &env,
        ResourceSpendingLimit {
            resource_hash: unknown_resource,
            max_amount_per_payment: 50,
            max_amount_per_day: 50,
        },
    ];
    assert_eq!(
        client.try_set_policy(&invalid_policy3, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    // 4. Duplicate resource in resource_limits
    let mut invalid_policy4 = standard_policy(&env, &agent, &seller, &asset, &resource_a, 100);
    invalid_policy4.resource_limits = vec![
        &env,
        ResourceSpendingLimit {
            resource_hash: resource_a.clone(),
            max_amount_per_payment: 25,
            max_amount_per_day: 50,
        },
        ResourceSpendingLimit {
            resource_hash: resource_a.clone(),
            max_amount_per_payment: 20,
            max_amount_per_day: 40,
        },
    ];
    assert_eq!(
        client.try_set_policy(&invalid_policy4, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    // 5. Valid policy with resource A and B ceilings
    let mut valid_policy = standard_policy(&env, &agent, &seller, &asset, &resource_a, 100_000);
    valid_policy.allowed_resource_hashes = vec![&env, resource_a.clone(), resource_b.clone()];
    valid_policy.resource_limits = vec![
        &env,
        ResourceSpendingLimit {
            resource_hash: resource_a.clone(),
            max_amount_per_payment: 25,
            max_amount_per_day: 40,
        },
        ResourceSpendingLimit {
            resource_hash: resource_b.clone(),
            max_amount_per_payment: 35,
            max_amount_per_day: 50,
        },
    ];
    client.set_policy(&valid_policy, &0);

    // Exact per-payment boundary for resource A
    assert!(client
        .try_check_payment(&agent, &seller, &asset, &25, &resource_a)
        .is_ok());
    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &26, &resource_a),
        Err(Ok(PolicyWalletError::AmountExceedsPaymentCap))
    );

    // Authorize payments to exact daily boundary for resource A
    client.authorize_payment(&agent, &seller, &asset, &25, &resource_a);
    client.authorize_payment(&agent, &seller, &asset, &15, &resource_a);
    assert_eq!(client.spent_today_resource(&agent, &resource_a), 40);
    assert_eq!(client.spent_today_resource(&agent, &resource_b), 0);

    // Exceeding daily boundary fails
    assert_eq!(
        client.try_authorize_payment(&agent, &seller, &asset, &1, &resource_a),
        Err(Ok(PolicyWalletError::AmountExceedsDailyCap))
    );

    // Counters isolated across resources: resource B can spend
    client.authorize_payment(&agent, &seller, &asset, &35, &resource_b);
    assert_eq!(client.spent_today_resource(&agent, &resource_b), 35);
    assert_eq!(client.spent_today(&agent), 75);

    // 6. Policy replacement semantics:
    // Replace with a policy with a lower cap for resource A (e.g. 30 daily cap).
    // Historical spend (40) is preserved and exceeds the new cap (40 > 30).
    let mut lower_cap_policy = standard_policy(&env, &agent, &seller, &asset, &resource_a, 100_000);
    lower_cap_policy.allowed_resource_hashes = vec![&env, resource_a.clone(), resource_b.clone()];
    lower_cap_policy.resource_limits = vec![
        &env,
        ResourceSpendingLimit {
            resource_hash: resource_a.clone(),
            max_amount_per_payment: 25,
            max_amount_per_day: 30, // lower than 40 already spent
        },
    ];
    client.set_policy(&lower_cap_policy, &1);
    assert_eq!(
        client.try_authorize_payment(&agent, &seller, &asset, &1, &resource_a),
        Err(Ok(PolicyWalletError::AmountExceedsDailyCap))
    );

    // Replace with a higher cap for resource A (e.g. 60 daily cap).
    let mut higher_cap_policy =
        standard_policy(&env, &agent, &seller, &asset, &resource_a, 100_000);
    higher_cap_policy.allowed_resource_hashes = vec![&env, resource_a.clone(), resource_b.clone()];
    higher_cap_policy.resource_limits = vec![
        &env,
        ResourceSpendingLimit {
            resource_hash: resource_a.clone(),
            max_amount_per_payment: 25,
            max_amount_per_day: 60, // higher than 40 already spent
        },
    ];
    client.set_policy(&higher_cap_policy, &2);
    // Now can spend 15 more (40 + 15 = 55 <= 60)
    assert!(client
        .try_authorize_payment(&agent, &seller, &asset, &15, &resource_a)
        .is_ok());
    assert_eq!(client.spent_today_resource(&agent, &resource_a), 55);

    // 7. Day rollover semantics
    env.ledger().set_sequence_number(LEDGERS_PER_DAY + 10);
    assert_eq!(client.spent_today_resource(&agent, &resource_a), 0);
    assert_eq!(client.spent_today_resource(&agent, &resource_b), 0);
    assert_eq!(client.spent_today(&agent), 0);

    // Spend again on the new day
    assert!(client
        .try_authorize_payment(&agent, &seller, &asset, &25, &resource_a)
        .is_ok());
    assert_eq!(client.spent_today_resource(&agent, &resource_a), 25);
}

#[test]
fn documentation_authorization_limit_example_reports_limit_exceeded() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    let mut policy = standard_policy(&env, &agent, &seller, &asset, &resource_hash, 100);
    policy.max_authorizations_per_day = 1;
    client.set_policy(&policy, &0);

    // 1st authorization succeeds
    assert!(client
        .try_authorize_payment(&agent, &seller, &asset, &10, &resource_hash)
        .is_ok());
    assert_eq!(client.authorized_count_today(&agent), 1);

    // 2nd authorization exceeds the daily count limit of 1
    assert_eq!(
        client.try_authorize_payment(&agent, &seller, &asset, &10, &resource_hash),
        Err(Ok(PolicyWalletError::AuthorizationLimitExceeded))
    );
}

#[test]
fn authorization_limit_isolation_and_rollover() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent_a, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    let agent_b = Address::generate(&env);
    let wrong_seller = Address::generate(&env);

    // Setup policy for Agent A: limit 2 authorizations per day
    let mut policy_a = standard_policy(&env, &agent_a, &seller, &asset, &resource_hash, 100_000);
    policy_a.max_authorizations_per_day = 2;
    client.set_policy(&policy_a, &0);

    // Setup policy for Agent B: limit 2 authorizations per day
    let mut policy_b = standard_policy(&env, &agent_b, &seller, &asset, &resource_hash, 100_000);
    policy_b.agent = agent_b.clone();
    policy_b.max_authorizations_per_day = 2;
    client.set_policy(&policy_b, &0);

    // Initial count is 0
    assert_eq!(client.authorized_count_today(&agent_a), 0);
    assert_eq!(client.authorized_count_today(&agent_b), 0);

    // check_payment does NOT increment count
    assert!(client
        .try_check_payment(&agent_a, &seller, &asset, &10, &resource_hash)
        .is_ok());
    assert_eq!(client.authorized_count_today(&agent_a), 0);

    // Failed authorizations do NOT increment count
    assert_eq!(
        client.try_authorize_payment(&agent_a, &wrong_seller, &asset, &10, &resource_hash),
        Err(Ok(PolicyWalletError::SellerNotAllowed))
    );
    assert_eq!(client.authorized_count_today(&agent_a), 0);

    assert_eq!(
        client.try_authorize_payment(&agent_a, &seller, &asset, &999, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsPaymentCap))
    );
    assert_eq!(client.authorized_count_today(&agent_a), 0);

    // First successful authorization increments count to 1
    client.authorize_payment(&agent_a, &seller, &asset, &10, &resource_hash);
    assert_eq!(client.authorized_count_today(&agent_a), 1);
    assert_eq!(client.authorized_count_today(&agent_b), 0);

    // Second successful authorization reaches exact limit of 2
    client.authorize_payment(&agent_a, &seller, &asset, &10, &resource_hash);
    assert_eq!(client.authorized_count_today(&agent_a), 2);
    assert_eq!(client.authorized_count_today(&agent_b), 0);

    // Third attempt fails with AuthorizationLimitExceeded and count remains 2
    assert_eq!(
        client.try_authorize_payment(&agent_a, &seller, &asset, &10, &resource_hash),
        Err(Ok(PolicyWalletError::AuthorizationLimitExceeded))
    );
    assert_eq!(client.authorized_count_today(&agent_a), 2);

    // check_payment also reports AuthorizationLimitExceeded
    assert_eq!(
        client.try_check_payment(&agent_a, &seller, &asset, &10, &resource_hash),
        Err(Ok(PolicyWalletError::AuthorizationLimitExceeded))
    );

    // Multi-agent isolation: Agent B is completely unaffected by Agent A's limit
    assert!(client
        .try_authorize_payment(&agent_b, &seller, &asset, &15, &resource_hash)
        .is_ok());
    assert_eq!(client.authorized_count_today(&agent_b), 1);
    assert_eq!(client.authorized_count_today(&agent_a), 2);

    // Day rollover: advance ledger sequence into next day
    env.ledger().set_sequence_number(LEDGERS_PER_DAY + 1);
    assert_eq!(client.authorized_count_today(&agent_a), 0);
    assert_eq!(client.authorized_count_today(&agent_b), 0);

    // Agent A can now authorize again on the new day
    assert!(client
        .try_authorize_payment(&agent_a, &seller, &asset, &10, &resource_hash)
        .is_ok());
    assert_eq!(client.authorized_count_today(&agent_a), 1);
}

#[test]
fn documentation_asset_payment_cap_example_reports_amount_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    let mut policy = standard_policy(&env, &agent, &seller, &asset, &resource_hash, 100);
    policy.asset_limits = vec![
        &env,
        AssetSpendingLimit {
            asset: asset.clone(),
            max_amount_per_payment: 20,
            max_amount_per_day: 60,
        },
    ];
    client.set_policy(&policy, &0);

    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &25, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsPaymentCap))
    );
}

#[test]
fn documentation_asset_daily_cap_example_reports_daily_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset_a, _owner, resource_hash) = initialized_wallet(&env);
    let asset_b = Address::generate(&env);

    let mut policy = standard_policy(&env, &agent, &seller, &asset_a, &resource_hash, 100);
    policy.allowed_assets = vec![&env, asset_a.clone(), asset_b.clone()];
    policy.asset_limits = vec![
        &env,
        AssetSpendingLimit {
            asset: asset_a.clone(),
            max_amount_per_payment: 30,
            max_amount_per_day: 45,
        },
        AssetSpendingLimit {
            asset: asset_b.clone(),
            max_amount_per_payment: 40,
            max_amount_per_day: 60,
        },
    ];
    client.set_policy(&policy, &0);

    // Spend 25 then 20 in asset A -> reaches asset A's daily cap of 45
    client.authorize_payment(&agent, &seller, &asset_a, &25, &resource_hash);
    client.authorize_payment(&agent, &seller, &asset_a, &20, &resource_hash);
    assert_eq!(client.spent_today_asset(&agent, &asset_a), 45);
    assert_eq!(client.spent_today_asset(&agent, &asset_b), 0);

    // Further spend in asset A is rejected by asset A's daily cap
    assert_eq!(
        client.try_authorize_payment(&agent, &seller, &asset_a, &1, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsDailyCap))
    );

    // Spend in asset B remains isolated and succeeds up to asset B's ceiling and the global cap
    assert!(client
        .try_authorize_payment(&agent, &seller, &asset_b, &35, &resource_hash)
        .is_ok());
    assert_eq!(client.spent_today_asset(&agent, &asset_b), 35);
    assert_eq!(client.spent_today(&agent), 80);
}

#[test]
fn per_asset_spending_ceilings_isolation_and_boundaries() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset_a, _owner, resource_hash) = initialized_wallet(&env);
    let asset_b = Address::generate(&env);
    let unknown_asset = Address::generate(&env);

    // 1. Missing explicit ceiling for an allowed asset fails deterministically
    let mut missing_all_ceilings =
        standard_policy(&env, &agent, &seller, &asset_a, &resource_hash, 100);
    missing_all_ceilings.asset_limits = vec![&env];
    assert_eq!(
        client.try_set_policy(&missing_all_ceilings, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    let mut missing_second_asset_ceiling =
        standard_policy(&env, &agent, &seller, &asset_a, &resource_hash, 100);
    missing_second_asset_ceiling.allowed_assets = vec![&env, asset_a.clone(), asset_b.clone()];
    missing_second_asset_ceiling.asset_limits = vec![
        &env,
        AssetSpendingLimit {
            asset: asset_a.clone(),
            max_amount_per_payment: 30,
            max_amount_per_day: 50,
        },
    ];
    assert_eq!(
        client.try_set_policy(&missing_second_asset_ceiling, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    // 2. Unlisted asset in asset_limits fails deterministically
    let mut unlisted_asset_policy =
        standard_policy(&env, &agent, &seller, &asset_a, &resource_hash, 100);
    unlisted_asset_policy.asset_limits = vec![
        &env,
        AssetSpendingLimit {
            asset: unknown_asset,
            max_amount_per_payment: 30,
            max_amount_per_day: 50,
        },
    ];
    assert_eq!(
        client.try_set_policy(&unlisted_asset_policy, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    // 3. Duplicate asset in asset_limits fails deterministically
    let mut duplicate_asset_limit_policy =
        standard_policy(&env, &agent, &seller, &asset_a, &resource_hash, 100);
    duplicate_asset_limit_policy.allowed_assets = vec![&env, asset_a.clone(), asset_b.clone()];
    duplicate_asset_limit_policy.asset_limits = vec![
        &env,
        AssetSpendingLimit {
            asset: asset_a.clone(),
            max_amount_per_payment: 30,
            max_amount_per_day: 50,
        },
        AssetSpendingLimit {
            asset: asset_a.clone(),
            max_amount_per_payment: 20,
            max_amount_per_day: 40,
        },
    ];
    assert_eq!(
        client.try_set_policy(&duplicate_asset_limit_policy, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    // 4. Invalid per-asset ceiling bounds (zero, negative, inverted, exceeding global payment/daily caps)
    for (payment_cap, daily_cap) in [
        (0, 50),
        (-1, 50),
        (30, 0),
        (30, -1),
        (60, 50),
        (80, 90),
        (50, 120),
    ] {
        let mut invalid_bounds_policy =
            standard_policy(&env, &agent, &seller, &asset_a, &resource_hash, 100);
        invalid_bounds_policy.asset_limits = vec![
            &env,
            AssetSpendingLimit {
                asset: asset_a.clone(),
                max_amount_per_payment: payment_cap,
                max_amount_per_day: daily_cap,
            },
        ];
        assert_eq!(
            client.try_set_policy(&invalid_bounds_policy, &0),
            Err(Ok(PolicyWalletError::InvalidPolicy))
        );
    }

    // 5. Valid policy with distinct ceilings for asset A and asset B
    let mut valid_policy =
        standard_policy(&env, &agent, &seller, &asset_a, &resource_hash, 100_000);
    valid_policy.max_amount_per_payment = 1_000;
    valid_policy.max_amount_per_day = 2_000;
    valid_policy.allowed_assets = vec![&env, asset_a.clone(), asset_b.clone()];
    valid_policy.asset_limits = vec![
        &env,
        AssetSpendingLimit {
            asset: asset_a.clone(),
            max_amount_per_payment: 30,
            max_amount_per_day: 50,
        },
        AssetSpendingLimit {
            asset: asset_b.clone(),
            max_amount_per_payment: 400,
            max_amount_per_day: 900,
        },
    ];
    client.set_policy(&valid_policy, &0);

    // Exact per-payment boundary for asset A (30 allowed, 31 rejected)
    assert!(client
        .try_check_payment(&agent, &seller, &asset_a, &30, &resource_hash)
        .is_ok());
    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset_a, &31, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsPaymentCap))
    );

    // Exact per-payment boundary for asset B (400 allowed, 401 rejected)
    assert!(client
        .try_check_payment(&agent, &seller, &asset_b, &400, &resource_hash)
        .is_ok());
    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset_b, &401, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsPaymentCap))
    );

    // Authorize payments to exact daily boundary for asset A (30 + 20 = 50)
    client.authorize_payment(&agent, &seller, &asset_a, &30, &resource_hash);
    client.authorize_payment(&agent, &seller, &asset_a, &20, &resource_hash);
    assert_eq!(client.spent_today_asset(&agent, &asset_a), 50);
    assert_eq!(client.spent_today_asset(&agent, &asset_b), 0);

    // 1 unit over asset A daily ceiling fails without mutating asset A or asset B counters
    assert_eq!(
        client.try_authorize_payment(&agent, &seller, &asset_a, &1, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsDailyCap))
    );
    assert_eq!(client.spent_today_asset(&agent, &asset_a), 50);

    // Asset B counter is isolated from asset A and can spend up to its own ceiling (400 + 400 + 100 = 900)
    client.authorize_payment(&agent, &seller, &asset_b, &400, &resource_hash);
    client.authorize_payment(&agent, &seller, &asset_b, &400, &resource_hash);
    client.authorize_payment(&agent, &seller, &asset_b, &100, &resource_hash);
    assert_eq!(client.spent_today_asset(&agent, &asset_b), 900);
    assert_eq!(client.spent_today_asset(&agent, &asset_a), 50);
    assert_eq!(client.spent_today(&agent), 950);

    assert_eq!(
        client.try_authorize_payment(&agent, &seller, &asset_b, &1, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsDailyCap))
    );

    // 6. Day rollover resets per-asset spend counters
    env.ledger().set_sequence_number(LEDGERS_PER_DAY + 5);
    assert_eq!(client.spent_today_asset(&agent, &asset_a), 0);
    assert_eq!(client.spent_today_asset(&agent, &asset_b), 0);
    client.authorize_payment(&agent, &seller, &asset_a, &30, &resource_hash);
    assert_eq!(client.spent_today_asset(&agent, &asset_a), 30);

    // 7. Overflow boundary at i128::MAX fails deterministically with AmountExceedsDailyCap
    let overflow_agent = Address::generate(&env);
    let mut max_policy = standard_policy(
        &env,
        &overflow_agent,
        &seller,
        &asset_a,
        &resource_hash,
        100_000,
    );
    max_policy.max_amount_per_payment = i128::MAX;
    max_policy.max_amount_per_day = i128::MAX;
    max_policy.asset_limits = vec![
        &env,
        AssetSpendingLimit {
            asset: asset_a.clone(),
            max_amount_per_payment: i128::MAX,
            max_amount_per_day: i128::MAX,
        },
    ];
    client.set_policy(&max_policy, &0);
    client.authorize_payment(
        &overflow_agent,
        &seller,
        &asset_a,
        &(i128::MAX - 10),
        &resource_hash,
    );
    assert_eq!(
        client.spent_today_asset(&overflow_agent, &asset_a),
        i128::MAX - 10
    );
    assert_eq!(
        client.try_authorize_payment(&overflow_agent, &seller, &asset_a, &11, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsDailyCap))
    );
    assert_eq!(
        client.try_authorize_payment(&overflow_agent, &seller, &asset_a, &10, &resource_hash),
        Ok(Ok(()))
    );
    assert_eq!(
        client.spent_today_asset(&overflow_agent, &asset_a),
        i128::MAX
    );
    assert_eq!(
        client.try_authorize_payment(&overflow_agent, &seller, &asset_a, &1, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsDailyCap))
    );
}

#[test]
fn owner_revocation_denies_later_checks_and_authorizations() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, owner, resource_hash) = initialized_wallet(&env);
    set_standard_policy(&env, &client, &agent, &seller, &asset, &resource_hash);
    client.authorize_payment(&agent, &seller, &asset, &60, &resource_hash);
    env.ledger().set_sequence_number(42);

    client.revoke_policy(&agent);

    let expected = AgentPolicyRevoked {
        agent: agent.clone(),
        owner,
        revoked_at_ledger: 42,
    }
    .to_xdr(&env, &client.address);
    assert_eq!(
        env.events()
            .all()
            .filter_by_contract(&client.address)
            .events()
            .last(),
        Some(&expected)
    );
    assert_eq!(client.get_policy_revocation(&agent), Some(42));
    assert_eq!(
        client.try_get_policy(&agent),
        Err(Ok(PolicyWalletError::PolicyRevoked))
    );
    assert_eq!(
        client.try_check_payment(&agent, &seller, &asset, &1, &resource_hash),
        Err(Ok(PolicyWalletError::PolicyRevoked))
    );
    assert_eq!(
        client.try_authorize_payment(&agent, &seller, &asset, &1, &resource_hash),
        Err(Ok(PolicyWalletError::PolicyRevoked))
    );
    assert_eq!(client.spent_today(&agent), 60);
}

#[test]
fn setting_a_policy_again_is_an_explicit_regrant() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);
    set_standard_policy(&env, &client, &agent, &seller, &asset, &resource_hash);
    client.authorize_payment(&agent, &seller, &asset, &70, &resource_hash);
    client.revoke_policy(&agent);

    set_standard_policy(&env, &client, &agent, &seller, &asset, &resource_hash);
    assert_eq!(client.get_policy_revocation(&agent), None);
    assert_eq!(
        client.try_authorize_payment(&agent, &seller, &asset, &31, &resource_hash),
        Err(Ok(PolicyWalletError::AmountExceedsDailyCap))
    );
    client.authorize_payment(&agent, &seller, &asset, &30, &resource_hash);
    assert_eq!(client.spent_today(&agent), 100);
}

#[test]
fn policy_creation_and_update_follow_deterministic_revisions() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);

    let mut policy = standard_policy(&env, &agent, &seller, &asset, &resource_hash, 100);
    client.set_policy(&policy, &0);

    let stored = client.get_policy(&agent);
    assert_eq!(stored.revision, 1);
    assert_eq!(client.get_policy_revision(&agent), 1);

    policy.max_amount_per_payment = 80;
    client.set_policy(&policy, &1);

    let updated = client.get_policy(&agent);
    assert_eq!(updated.revision, 2);
    assert_eq!(updated.max_amount_per_payment, 80);
    assert_eq!(client.get_policy_revision(&agent), 2);
}

#[test]
fn stale_expected_revision_fails_without_modifying_policy_or_spend() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);

    let mut policy = standard_policy(&env, &agent, &seller, &asset, &resource_hash, 100);
    client.set_policy(&policy, &0);

    client.authorize_payment(&agent, &seller, &asset, &20, &resource_hash);
    assert_eq!(client.spent_today(&agent), 20);

    policy.max_amount_per_payment = 90;
    let res = client.try_set_policy(&policy, &0);
    assert_eq!(res, Err(Ok(PolicyWalletError::StaleRevision)));

    let stored = client.get_policy(&agent);
    assert_eq!(stored.revision, 1);
    assert_eq!(stored.max_amount_per_payment, 75);
    assert_eq!(client.spent_today(&agent), 20);
}

#[test]
fn allowlists_enforce_exact_limits_and_fail_at_limit_plus_one() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, _seller, _asset, _owner, _resource_hash) = initialized_wallet(&env);

    let mut sellers_max = Vec::new(&env);
    for _ in 0..MAX_ALLOWED_SELLERS {
        sellers_max.push_back(Address::generate(&env));
    }
    let mut assets_max = Vec::new(&env);
    let mut asset_limits_max = Vec::new(&env);
    for _ in 0..MAX_ALLOWED_ASSETS {
        let a = Address::generate(&env);
        assets_max.push_back(a.clone());
        asset_limits_max.push_back(AssetSpendingLimit {
            asset: a,
            max_amount_per_payment: 50,
            max_amount_per_day: 100,
        });
    }
    let mut hashes_max = Vec::new(&env);
    for i in 0..MAX_ALLOWED_RESOURCE_HASHES {
        hashes_max.push_back(BytesN::from_array(&env, &[(i + 1) as u8; 32]));
    }

    let exact_policy = SpendingPolicy {
        agent: agent.clone(),
        max_amount_per_payment: 50,
        max_amount_per_day: 100,
        max_authorizations_per_day: 10,
        valid_from_ledger: 0,
        valid_until_ledger: 100,
        allowed_sellers: sellers_max.clone(),
        allowed_assets: assets_max.clone(),
        allowed_resource_hashes: hashes_max.clone(),
        seller_limits: vec![&env],
        asset_limits: asset_limits_max.clone(),
        resource_limits: vec![&env],
        revision: 0,
    };
    assert!(client.try_set_policy(&exact_policy, &0).is_ok());

    let agent_oversized = Address::generate(&env);
    let mut sellers_oversized = sellers_max.clone();
    sellers_oversized.push_back(Address::generate(&env));
    let mut p_sellers_over = exact_policy.clone();
    p_sellers_over.agent = agent_oversized.clone();
    p_sellers_over.allowed_sellers = sellers_oversized;
    assert_eq!(
        client.try_set_policy(&p_sellers_over, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    let mut assets_oversized = assets_max.clone();
    let extra_asset = Address::generate(&env);
    assets_oversized.push_back(extra_asset.clone());
    let mut asset_limits_oversized = asset_limits_max.clone();
    asset_limits_oversized.push_back(AssetSpendingLimit {
        asset: extra_asset,
        max_amount_per_payment: 50,
        max_amount_per_day: 100,
    });
    let mut p_assets_over = exact_policy.clone();
    p_assets_over.agent = agent_oversized.clone();
    p_assets_over.allowed_assets = assets_oversized;
    p_assets_over.asset_limits = asset_limits_oversized;
    assert_eq!(
        client.try_set_policy(&p_assets_over, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );

    let mut hashes_oversized = hashes_max.clone();
    hashes_oversized.push_back(BytesN::from_array(&env, &[99; 32]));
    let mut p_hashes_over = exact_policy;
    p_hashes_over.agent = agent_oversized;
    p_hashes_over.allowed_resource_hashes = hashes_oversized;
    assert_eq!(
        client.try_set_policy(&p_hashes_over, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );
}

#[test]
fn allowlists_reject_duplicate_sellers_deterministically() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);

    let mut dup_policy = standard_policy(&env, &agent, &seller, &asset, &resource_hash, 100);
    dup_policy.allowed_sellers = vec![&env, seller.clone(), seller];
    assert_eq!(
        client.try_set_policy(&dup_policy, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );
}

#[test]
fn allowlists_reject_duplicate_assets_deterministically() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, agent, seller, asset, _owner, resource_hash) = initialized_wallet(&env);

    let mut dup_policy = standard_policy(&env, &agent, &seller, &asset, &resource_hash, 100);
    dup_policy.allowed_assets = vec![&env, asset.clone(), asset.clone()];
    dup_policy.asset_limits = vec![
        &env,
        AssetSpendingLimit {
            asset: asset.clone(),
            max_amount_per_payment: 75,
            max_amount_per_day: 100,
        },
        AssetSpendingLimit {
            asset,
            max_amount_per_payment: 75,
            max_amount_per_day: 100,
        },
    ];
    assert_eq!(
        client.try_set_policy(&dup_policy, &0),
        Err(Ok(PolicyWalletError::InvalidPolicy))
    );
}
