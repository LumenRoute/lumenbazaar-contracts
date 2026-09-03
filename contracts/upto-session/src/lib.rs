#![no_std]

mod errors;
pub mod ids;
pub mod storage;
mod types;
pub mod validation;

pub use errors::ContractError;
pub use types::{Session, SessionStatus};

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct UptoSessionContract;

#[contractimpl]
impl UptoSessionContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        if storage::has_admin(&env) {
            return Err(ContractError::AlreadyInitialized);
        }

        admin.require_auth();
        storage::write_admin(&env, &admin);
        storage::write_storage_layout_version(&env);

        Ok(())
    }

    pub fn create_session(
        env: Env,
        buyer: Address,
        seller: Address,
        asset: Address,
        max_amount: i128,
        expires_at_ledger: u32,
        resource_hash: BytesN<32>,
    ) -> Result<BytesN<32>, ContractError> {
        validation::validate_create_session(
            &env,
            &buyer,
            &seller,
            &asset,
            max_amount,
            expires_at_ledger,
            &resource_hash,
        )?;

        let sequence = storage::take_next_session_sequence(&env);
        Ok(ids::derive_session_id(
            &env,
            &ids::SessionIdInput {
                buyer: &buyer,
                seller: &seller,
                asset: &asset,
                max_amount,
                expires_at_ledger,
                resource_hash: &resource_hash,
                sequence,
            },
        ))
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
