extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    token, Address, BytesN, Env,
};

fn create_test_asset(env: &Env, buyer: &Address, amount: i128) -> Address {
    let token_admin = Address::generate(env);
    let asset = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    token::StellarAssetClient::new(env, &asset).mint(buyer, &amount);
    asset
}

#[test]
fn public_interface_is_callable() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = create_test_asset(&env, &buyer, 100);
    let resource_hash = BytesN::from_array(&env, &[7; 32]);

    client.initialize(&buyer);

    let expected_id = ids::derive_session_id(
        &env,
        &ids::SessionIdInput {
            buyer: &buyer,
            seller: &seller,
            asset: &asset,
            max_amount: 100,
            expires_at_ledger: 10,
            resource_hash: &resource_hash,
            sequence: 0,
        },
    );
    let session_id = client.create_session(&buyer, &seller, &asset, &100, &10, &resource_hash);

    assert_eq!(session_id, expected_id);
    assert_eq!(client.get_session(&session_id).id, session_id);
    client.settle(&session_id, &10, &resource_hash);
    assert_eq!(client.get_session(&session_id).settled_amount, 10);
    assert_eq!(
        client.get_session(&session_id).status,
        SessionStatus::Settled
    );

    // Test cancel on a different open session
    let session_id_2 = client.create_session(&buyer, &seller, &asset, &100, &10, &resource_hash);
    client.cancel(&session_id_2);

    // Test extend_ttl on the settled session
    client.extend_ttl(&session_id);
}

#[test]
fn initialize_stores_admin_once() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    env.as_contract(&contract_id, || {
        assert_eq!(storage::read_admin(&env), Some(admin.clone()));
        assert_eq!(
            storage::read_storage_layout_version(&env),
            Some(storage::STORAGE_LAYOUT_VERSION)
        );
    });

    assert_eq!(
        client.try_initialize(&admin),
        Err(Ok(ContractError::AlreadyInitialized))
    );
}

#[test]
fn invalid_create_inputs_do_not_consume_sequence() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[4; 32]);

    assert_eq!(
        client.try_create_session(&buyer, &seller, &asset, &0, &10, &resource_hash),
        Err(Ok(ContractError::InvalidAmount))
    );

    env.as_contract(&contract_id, || {
        assert_eq!(storage::read_next_session_sequence(&env), 0);
    });
}

#[test]
fn expired_create_input_fails_before_storage_write() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(20);
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[4; 32]);

    assert_eq!(
        client.try_create_session(&buyer, &seller, &asset, &100, &20, &resource_hash),
        Err(Ok(ContractError::ExpiredSession))
    );

    env.as_contract(&contract_id, || {
        assert_eq!(storage::read_next_session_sequence(&env), 0);
    });
}

#[test]
fn create_session_stores_open_session() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[5; 32]);

    let session_id = client.create_session(&buyer, &seller, &asset, &500, &25, &resource_hash);

    env.as_contract(&contract_id, || {
        let session = storage::read_session(&env, &session_id).unwrap();

        assert_eq!(session.id, session_id);
        assert_eq!(session.buyer, buyer);
        assert_eq!(session.seller, seller);
        assert_eq!(session.asset, asset);
        assert_eq!(session.max_amount, 500);
        assert_eq!(session.settled_amount, 0);
        assert_eq!(session.expires_at_ledger, 25);
        assert_eq!(session.resource_hash, resource_hash);
        assert_eq!(session.usage_hash, None);
        assert_eq!(session.status, SessionStatus::Open);
    });
}

#[test]
fn create_session_emits_stable_event() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[5; 32]);

    client.create_session(&buyer, &seller, &asset, &500, &25, &resource_hash);

    assert_eq!(env.events().all().events().len(), 1);
}

#[test]
fn create_session_requires_buyer_auth() {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[5; 32]);

    let result = client.try_create_session(&buyer, &seller, &asset, &500, &25, &resource_hash);

    assert!(result.is_err());
    env.as_contract(&contract_id, || {
        assert_eq!(storage::read_next_session_sequence(&env), 0);
    });
}

#[test]
fn get_session_returns_full_state() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[6; 32]);

    let session_id = client.create_session(&buyer, &seller, &asset, &900, &30, &resource_hash);
    let session = client.get_session(&session_id);

    assert_eq!(session.id, session_id);
    assert_eq!(session.buyer, buyer);
    assert_eq!(session.seller, seller);
    assert_eq!(session.asset, asset);
    assert_eq!(session.max_amount, 900);
    assert_eq!(session.settled_amount, 0);
    assert_eq!(session.expires_at_ledger, 30);
    assert_eq!(session.resource_hash, resource_hash);
    assert_eq!(session.usage_hash, None);
    assert_eq!(session.status, SessionStatus::Open);
}

#[test]
fn get_session_returns_not_found_for_missing_session() {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let missing_id = BytesN::from_array(&env, &[8; 32]);

    assert_eq!(
        client.try_get_session(&missing_id),
        Err(Ok(ContractError::SessionNotFound))
    );
}

#[test]
fn settle_returns_not_found_for_missing_session() {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let missing_id = BytesN::from_array(&env, &[8; 32]);
    let usage_hash = BytesN::from_array(&env, &[9; 32]);

    assert_eq!(
        client.try_settle(&missing_id, &10, &usage_hash),
        Err(Ok(ContractError::SessionNotFound))
    );
}

#[test]
fn settle_requires_seller_auth() {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let session_id = BytesN::from_array(&env, &[1; 32]);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[2; 32]);
    let usage_hash = BytesN::from_array(&env, &[9; 32]);

    env.as_contract(&contract_id, || {
        storage::write_session(
            &env,
            &Session {
                id: session_id.clone(),
                buyer,
                seller,
                asset,
                max_amount: 100,
                settled_amount: 0,
                expires_at_ledger: 50,
                resource_hash,
                usage_hash: None,
                status: SessionStatus::Open,
            },
        );
    });

    assert!(client.try_settle(&session_id, &10, &usage_hash).is_err());
}

#[test]
fn settle_rejects_finalized_sessions() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[2; 32]);
    let usage_hash = BytesN::from_array(&env, &[9; 32]);
    let settled_id = BytesN::from_array(&env, &[10; 32]);
    let cancelled_id = BytesN::from_array(&env, &[11; 32]);

    env.as_contract(&contract_id, || {
        storage::write_session(
            &env,
            &Session {
                id: settled_id.clone(),
                buyer: buyer.clone(),
                seller: seller.clone(),
                asset: asset.clone(),
                max_amount: 100,
                settled_amount: 25,
                expires_at_ledger: 50,
                resource_hash: resource_hash.clone(),
                usage_hash: Some(usage_hash.clone()),
                status: SessionStatus::Settled,
            },
        );
        storage::write_session(
            &env,
            &Session {
                id: cancelled_id.clone(),
                buyer,
                seller,
                asset,
                max_amount: 100,
                settled_amount: 0,
                expires_at_ledger: 50,
                resource_hash,
                usage_hash: None,
                status: SessionStatus::Cancelled,
            },
        );
    });

    assert_eq!(
        client.try_settle(&settled_id, &10, &usage_hash),
        Err(Ok(ContractError::SessionAlreadySettled))
    );
    assert_eq!(
        client.try_settle(&cancelled_id, &10, &usage_hash),
        Err(Ok(ContractError::SessionCancelled))
    );
}

#[test]
fn settle_stores_actual_amount_and_status() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = create_test_asset(&env, &buyer, 500);
    let resource_hash = BytesN::from_array(&env, &[12; 32]);
    let usage_hash = BytesN::from_array(&env, &[13; 32]);
    let token_client = token::Client::new(&env, &asset);

    let session_id = client.create_session(&buyer, &seller, &asset, &500, &50, &resource_hash);
    client.settle(&session_id, &125, &usage_hash);
    let session = client.get_session(&session_id);

    assert_eq!(session.settled_amount, 125);
    assert_eq!(session.usage_hash, Some(usage_hash));
    assert_eq!(session.status, SessionStatus::Settled);
    assert_eq!(token_client.balance(&buyer), 375);
    assert_eq!(token_client.balance(&seller), 125);
}

#[test]
fn settle_rejects_invalid_amounts_and_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[12; 32]);
    let usage_hash = BytesN::from_array(&env, &[13; 32]);

    let zero_amount_id = client.create_session(&buyer, &seller, &asset, &500, &50, &resource_hash);
    let over_cap_id = client.create_session(&buyer, &seller, &asset, &500, &50, &resource_hash);
    let expired_id = client.create_session(&buyer, &seller, &asset, &500, &50, &resource_hash);

    assert_eq!(
        client.try_settle(&zero_amount_id, &0, &usage_hash),
        Err(Ok(ContractError::InvalidAmount))
    );
    assert_eq!(
        client.try_settle(&over_cap_id, &501, &usage_hash),
        Err(Ok(ContractError::AmountExceedsCap))
    );

    env.ledger().set_sequence_number(50);

    assert_eq!(
        client.try_settle(&expired_id, &100, &usage_hash),
        Err(Ok(ContractError::ExpiredSession))
    );
    assert_eq!(client.get_session(&expired_id).settled_amount, 0);
    assert_eq!(client.get_session(&expired_id).status, SessionStatus::Open);
}

#[test]
fn settle_surfaces_asset_transfer_failure_without_finalizing_session() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = create_test_asset(&env, &buyer, 10);
    let resource_hash = BytesN::from_array(&env, &[12; 32]);
    let usage_hash = BytesN::from_array(&env, &[13; 32]);

    let session_id = client.create_session(&buyer, &seller, &asset, &500, &50, &resource_hash);

    assert!(client.try_settle(&session_id, &125, &usage_hash).is_err());
    let session = client.get_session(&session_id);

    assert_eq!(session.settled_amount, 0);
    assert_eq!(session.status, SessionStatus::Open);
}

#[test]
fn settle_rejects_empty_usage_hash_before_transfer() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = create_test_asset(&env, &buyer, 500);
    let token_client = token::Client::new(&env, &asset);
    let resource_hash = BytesN::from_array(&env, &[12; 32]);
    let usage_hash = BytesN::from_array(&env, &[0; 32]);

    let session_id = client.create_session(&buyer, &seller, &asset, &500, &50, &resource_hash);

    assert_eq!(
        client.try_settle(&session_id, &125, &usage_hash),
        Err(Ok(ContractError::InvalidUsageHash))
    );
    let session = client.get_session(&session_id);

    assert_eq!(session.usage_hash, None);
    assert_eq!(session.settled_amount, 0);
    assert_eq!(session.status, SessionStatus::Open);
    assert_eq!(token_client.balance(&buyer), 500);
    assert_eq!(token_client.balance(&seller), 0);
}

#[test]
fn settle_prevents_double_settlement() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = create_test_asset(&env, &buyer, 500);
    let token_client = token::Client::new(&env, &asset);
    let resource_hash = BytesN::from_array(&env, &[14; 32]);
    let usage_hash = BytesN::from_array(&env, &[15; 32]);

    let session_id = client.create_session(&buyer, &seller, &asset, &500, &50, &resource_hash);

    // First settlement succeeds
    client.settle(&session_id, &100, &usage_hash);
    let session_after_first = client.get_session(&session_id);
    assert_eq!(session_after_first.settled_amount, 100);
    assert_eq!(session_after_first.status, SessionStatus::Settled);
    assert_eq!(token_client.balance(&buyer), 400);
    assert_eq!(token_client.balance(&seller), 100);

    // Second settlement with same amount fails
    let result_same = client.try_settle(&session_id, &100, &usage_hash);
    assert_eq!(result_same, Err(Ok(ContractError::SessionAlreadySettled)));

    // Second settlement with different amount also fails
    let result_different = client.try_settle(&session_id, &50, &usage_hash);
    assert_eq!(
        result_different,
        Err(Ok(ContractError::SessionAlreadySettled))
    );

    // Session state unchanged after failed settlement attempts
    let session_after_attempts = client.get_session(&session_id);
    assert_eq!(session_after_attempts.settled_amount, 100);
    assert_eq!(session_after_attempts.status, SessionStatus::Settled);
    assert_eq!(token_client.balance(&buyer), 400);
    assert_eq!(token_client.balance(&seller), 100);
}

#[test]
fn settle_emits_stable_event() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = create_test_asset(&env, &buyer, 500);
    let resource_hash = BytesN::from_array(&env, &[16; 32]);
    let usage_hash = BytesN::from_array(&env, &[17; 32]);

    let session_id = client.create_session(&buyer, &seller, &asset, &500, &50, &resource_hash);

    client.settle(&session_id, &125, &usage_hash);

    assert_eq!(env.events().all().events().len(), 2);
}

#[test]
fn cancel_allows_buyer_cancellation_before_settlement() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[18; 32]);

    let session_id = client.create_session(&buyer, &seller, &asset, &500, &50, &resource_hash);
    let session_before = client.get_session(&session_id);
    assert_eq!(session_before.status, SessionStatus::Open);

    client.cancel(&session_id);
    let session_after = client.get_session(&session_id);

    assert_eq!(session_after.status, SessionStatus::Cancelled);
}

#[test]
fn cancel_requires_buyer_auth() {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let session_id = BytesN::from_array(&env, &[1; 32]);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[2; 32]);

    env.as_contract(&contract_id, || {
        storage::write_session(
            &env,
            &Session {
                id: session_id.clone(),
                buyer,
                seller,
                asset,
                max_amount: 100,
                settled_amount: 0,
                expires_at_ledger: 50,
                resource_hash,
                usage_hash: None,
                status: SessionStatus::Open,
            },
        );
    });

    assert!(client.try_cancel(&session_id).is_err());
}

#[test]
fn cancel_returns_not_found_for_missing_session() {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let missing_id = BytesN::from_array(&env, &[8; 32]);

    assert_eq!(
        client.try_cancel(&missing_id),
        Err(Ok(ContractError::SessionNotFound))
    );
}

#[test]
fn cancel_rejects_already_settled_session() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let session_id = BytesN::from_array(&env, &[19; 32]);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[20; 32]);
    let usage_hash = BytesN::from_array(&env, &[21; 32]);

    env.as_contract(&contract_id, || {
        storage::write_session(
            &env,
            &Session {
                id: session_id.clone(),
                buyer,
                seller,
                asset,
                max_amount: 100,
                settled_amount: 50,
                expires_at_ledger: 50,
                resource_hash,
                usage_hash: Some(usage_hash),
                status: SessionStatus::Settled,
            },
        );
    });

    assert_eq!(
        client.try_cancel(&session_id),
        Err(Ok(ContractError::SessionAlreadySettled))
    );
}

#[test]
fn cancel_rejects_already_cancelled_session() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let session_id = BytesN::from_array(&env, &[22; 32]);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[23; 32]);

    env.as_contract(&contract_id, || {
        storage::write_session(
            &env,
            &Session {
                id: session_id.clone(),
                buyer,
                seller,
                asset,
                max_amount: 100,
                settled_amount: 0,
                expires_at_ledger: 50,
                resource_hash,
                usage_hash: None,
                status: SessionStatus::Cancelled,
            },
        );
    });

    assert_eq!(
        client.try_cancel(&session_id),
        Err(Ok(ContractError::SessionCancelled))
    );
}

#[test]
fn cancel_emits_stable_event() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[24; 32]);

    let session_id = client.create_session(&buyer, &seller, &asset, &500, &50, &resource_hash);

    client.cancel(&session_id);

    assert_eq!(env.events().all().events().len(), 2);
}

#[test]
fn extend_ttl_succeeds_for_open_sessions() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[25; 32]);

    let session_id = client.create_session(&buyer, &seller, &asset, &500, &50, &resource_hash);

    assert!(client.try_extend_ttl(&session_id).is_ok());
}

#[test]
fn extend_ttl_succeeds_for_cancelled_sessions() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let session_id = BytesN::from_array(&env, &[26; 32]);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[27; 32]);

    env.as_contract(&contract_id, || {
        storage::write_session(
            &env,
            &Session {
                id: session_id.clone(),
                buyer,
                seller,
                asset,
                max_amount: 100,
                settled_amount: 0,
                expires_at_ledger: 50,
                resource_hash,
                usage_hash: None,
                status: SessionStatus::Cancelled,
            },
        );
    });

    assert!(client.try_extend_ttl(&session_id).is_ok());
}

#[test]
fn extend_ttl_rejects_settled_sessions() {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let session_id = BytesN::from_array(&env, &[28; 32]);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[29; 32]);
    let usage_hash = BytesN::from_array(&env, &[30; 32]);

    env.as_contract(&contract_id, || {
        storage::write_session(
            &env,
            &Session {
                id: session_id.clone(),
                buyer,
                seller,
                asset,
                max_amount: 100,
                settled_amount: 50,
                expires_at_ledger: 50,
                resource_hash,
                usage_hash: Some(usage_hash),
                status: SessionStatus::Settled,
            },
        );
    });

    assert_eq!(
        client.try_extend_ttl(&session_id),
        Err(Ok(ContractError::TtlExtensionFailed))
    );
}

#[test]
fn extend_ttl_rejects_missing_session() {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let missing_id = BytesN::from_array(&env, &[31; 32]);

    assert_eq!(
        client.try_extend_ttl(&missing_id),
        Err(Ok(ContractError::TtlExtensionFailed))
    );
}
