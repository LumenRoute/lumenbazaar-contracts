#![no_std]

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct PolicyWalletExampleContract;

#[contractimpl]
impl PolicyWalletExampleContract {
    pub fn example_only(_env: Env) -> bool {
        true
    }
}

#[cfg(test)]
mod test;
