extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env,
};

#[test]
fn public_interface_is_callable() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
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
    assert_eq!(
        client.try_get_session(&session_id),
        Err(Ok(ContractError::SessionNotFound))
    );
    client.settle(&session_id, &10, &resource_hash);
    client.cancel(&session_id);
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
