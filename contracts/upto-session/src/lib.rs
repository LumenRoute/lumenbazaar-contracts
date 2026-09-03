#![no_std]

mod errors;
pub mod storage;
mod types;

pub use errors::ContractError;
pub use types::{Session, SessionStatus};

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct UptoSessionContract;

#[contractimpl]
impl UptoSessionContract {
    pub fn initialize(_env: Env, _admin: Address) -> Result<(), ContractError> {
        Ok(())
    }

    pub fn create_session(
        _env: Env,
        _buyer: Address,
        _seller: Address,
        _asset: Address,
        _max_amount: i128,
        _expires_at_ledger: u32,
        resource_hash: BytesN<32>,
    ) -> Result<BytesN<32>, ContractError> {
        Ok(resource_hash)
    }

    pub fn settle(
        _env: Env,
        _session_id: BytesN<32>,
        _actual_amount: i128,
        _usage_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        Ok(())
    }

    pub fn cancel(_env: Env, _session_id: BytesN<32>) -> Result<(), ContractError> {
        Ok(())
    }

    pub fn get_session(_env: Env, _session_id: BytesN<32>) -> Result<Session, ContractError> {
        Err(ContractError::SessionNotFound)
    }

    pub fn extend_ttl(_env: Env, _session_id: BytesN<32>) -> Result<(), ContractError> {
        Ok(())
    }
}

#[cfg(test)]
mod test;
