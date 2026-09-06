#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WalletConfig {
    pub owner: Address,
    pub upto_session_contract: Address,
    pub initialized_at_ledger: u32,
    pub example_only: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PolicyWalletError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
}

#[contract]
pub struct PolicyWalletExampleContract;

#[contractimpl]
impl PolicyWalletExampleContract {
    pub fn initialize(
        env: Env,
        owner: Address,
        upto_session_contract: Address,
    ) -> Result<(), PolicyWalletError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(PolicyWalletError::AlreadyInitialized);
        }

        owner.require_auth();

        let config = WalletConfig {
            owner,
            upto_session_contract,
            initialized_at_ledger: env.ledger().sequence(),
            example_only: true,
        };
        env.storage().instance().set(&DataKey::Config, &config);

        Ok(())
    }

    pub fn get_config(env: Env) -> Result<WalletConfig, PolicyWalletError> {
        read_config(&env)
    }

    pub fn require_owner(env: Env) -> Result<(), PolicyWalletError> {
        read_config(&env)?.owner.require_auth();
        Ok(())
    }

    pub fn example_only(_env: Env) -> bool {
        true
    }
}

fn read_config(env: &Env) -> Result<WalletConfig, PolicyWalletError> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(PolicyWalletError::NotInitialized)
}

#[cfg(test)]
mod test;
