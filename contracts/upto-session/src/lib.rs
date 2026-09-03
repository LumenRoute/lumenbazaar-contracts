#![no_std]

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct UptoSessionContract;

#[contractimpl]
impl UptoSessionContract {
    pub fn ping(_env: Env) -> u32 {
        1
    }
}

#[cfg(test)]
mod test;
