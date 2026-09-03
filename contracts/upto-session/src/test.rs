extern crate std;

use super::*;
use soroban_sdk::Env;

#[test]
fn placeholder_contract_responds() {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);

    assert_eq!(client.ping(), 1);
}
