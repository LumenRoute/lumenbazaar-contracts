extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};
use upto_session::{ContractError, UptoSessionContract, UptoSessionContractClient};

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
    let missing_session_id = BytesN::from_array(&env, &[9; 32]);

    wallet_client.initialize(&owner, &upto_session_id);

    assert_eq!(
        upto_client.try_get_session(&missing_session_id),
        Err(Ok(ContractError::SessionNotFound))
    );
    assert!(upto_client.try_initialize(&owner).is_ok());
}
