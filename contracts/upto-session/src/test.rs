extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

#[test]
fn public_interface_is_callable() {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let resource_hash = BytesN::from_array(&env, &[7; 32]);

    client.initialize(&buyer);

    let session_id = client.create_session(&buyer, &seller, &asset, &100, &10, &resource_hash);

    assert_eq!(session_id, resource_hash);
    assert_eq!(
        client.try_get_session(&session_id),
        Err(Ok(ContractError::SessionNotFound))
    );
    client.settle(&session_id, &10, &resource_hash);
    client.cancel(&session_id);
    client.extend_ttl(&session_id);
}
