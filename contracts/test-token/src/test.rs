extern crate std;

use super::*;
use soroban_sdk::Env;

#[test]
fn test_token_utility_is_registered_independently() {
    let env = Env::default();
    let contract_id = env.register(TestTokenContract, ());
    let client = TestTokenContractClient::new(&env, &contract_id);

    assert!(client.utility_only());
}
