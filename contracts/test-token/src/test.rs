extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_token_utility_is_registered_independently() {
    let env = Env::default();
    let contract_id = env.register(TestTokenContract, ());
    let client = TestTokenContractClient::new(&env, &contract_id);

    assert!(client.utility_only());
    assert_eq!(client.decimals(), 7);
    assert_eq!(client.symbol(), String::from_str(&env, "LBT"));
}

#[test]
fn initializes_admin_once() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(TestTokenContract, ());
    let client = TestTokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    assert_eq!(
        client.try_initialize(&admin),
        Err(Ok(TokenError::AlreadyInitialized))
    );
}

#[test]
fn mint_requires_admin_auth_and_updates_balance() {
    let env = Env::default();
    let contract_id = env.register(TestTokenContract, ());
    let client = TestTokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);

    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::Admin, &admin);
    });

    assert!(client.try_mint(&buyer, &100).is_err());

    env.mock_all_auths();
    client.mint(&buyer, &100);

    assert_eq!(client.balance(&buyer), 100);
}

#[test]
fn transfer_requires_holder_auth_and_moves_balances() {
    let env = Env::default();
    let contract_id = env.register(TestTokenContract, ());
    let client = TestTokenContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);

    env.as_contract(&contract_id, || {
        write_balance(&env, &buyer, 100);
    });

    assert!(client.try_transfer(&buyer, &seller, &25).is_err());

    env.mock_all_auths();
    client.transfer(&buyer, &seller, &25);

    assert_eq!(client.balance(&buyer), 75);
    assert_eq!(client.balance(&seller), 25);
}

#[test]
fn rejects_invalid_amounts_and_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(TestTokenContract, ());
    let client = TestTokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);

    client.initialize(&admin);

    assert_eq!(
        client.try_mint(&buyer, &0),
        Err(Ok(TokenError::InvalidAmount))
    );
    assert_eq!(
        client.try_transfer(&buyer, &seller, &1),
        Err(Ok(TokenError::InsufficientBalance))
    );
}
