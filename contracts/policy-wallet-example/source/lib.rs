#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TestMetadata {
    pub config_name: String,
    pub version: u32,
    pub enabled: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoundedPolicy {
    pub max_daily_spend: i128,
    pub current_spent: i128,
    pub strict_enforcement: bool,
}

#[contracttype]
pub enum DataKey {
    TestMeta,
    Policy(Address),
}

#[contract]
pub struct PolicyWalletContract;

#[contractimpl]
impl PolicyWalletContract {
    /// Initialize or update configurable test metadata
    pub fn set_test_metadata(env: Env, config_name: String, version: u32, enabled: bool) {
        let metadata = TestMetadata {
            config_name,
            version,
            enabled,
        };
        env.storage().instance().set(&DataKey::TestMeta, &metadata);
        env.storage().instance().bump(10000);
    }

    /// Retrieve the current test metadata configuration
    pub fn get_test_metadata(env: Env) -> TestMetadata {
        env.storage()
            .instance()
            .get(&DataKey::TestMeta)
            .unwrap_or(TestMetadata {
                config_name: String::from_str(&env, "default"),
                version: 1,
                enabled: false,
            })
    }

    /// Configure bounded policy controls for a given user/wallet address
    pub fn set_bounded_policy(
        env: Env,
        user: Address,
        max_daily_spend: i128,
        strict_enforcement: bool,
    ) {
        user.require_auth();

        let policy = BoundedPolicy {
            max_daily_spend,
            current_spent: 0,
            strict_enforcement,
        };

        env.storage().persistent().set(&DataKey::Policy(user), &policy);
    }

    /// Check and enforce policy boundaries before allowing a transaction/spend
    pub fn verify_and_update_spend(env: Env, user: Address, amount: i128) -> bool {
        user.require_auth();

        let key = DataKey::Policy(user.clone());
        let mut policy: BoundedPolicy = match env.storage().persistent().get(&key) {
            Some(p) => p,
            None => return false, // No policy found, deny by default
        };

        let projected_spend = policy.current_spent + amount;
        if projected_spend > policy.max_daily_spend {
            if policy.strict_enforcement {
                panic!("Policy violation: Exceeded maximum bounded daily spend limit.");
            }
            return false;
        }

        policy.current_spent = projected_spend;
        env.storage().persistent().set(&key, &policy);
        true
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_metadata_and_policy_flow() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(PolicyWalletContract, ());
        let client = PolicyWalletContractClient::new(&env, &contract_id);

        // Test metadata configuration
        let name = String::from_str(&env, "beta-test-config");
        client.set_test_metadata(&name, &2, &true);
        let meta = client.get_test_metadata();
        assert_eq!(meta.version, 2);
        assert_eq!(meta.enabled, true);

        // Test bounded policy enforcement
        let user = Address::generate(&env);
        client.set_bounded_policy(&user, &1000, &true);

        let allowed = client.verify_and_update_spend(&user, &400);
        assert!(allowed);
    }
}
