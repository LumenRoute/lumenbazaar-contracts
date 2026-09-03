#![no_std]

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct TestTokenContract;

#[contractimpl]
impl TestTokenContract {
    pub fn utility_only(_env: Env) -> bool {
        true
    }
}

#[cfg(test)]
mod test;
