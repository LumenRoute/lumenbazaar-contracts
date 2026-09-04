use crate::Session;
use soroban_sdk::{contracttype, Address, BytesN, Env};

pub const STORAGE_LAYOUT_VERSION: u32 = 1;
pub const DEFAULT_TTL_THRESHOLD: u32 = 100_000;
pub const TTL_EXTENSION_AMOUNT: u32 = 1_000_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    NextSessionSequence,
    Session(BytesN<32>),
    StorageLayoutVersion,
}

pub fn write_storage_layout_version(env: &Env) {
    env.storage()
        .instance()
        .set(&DataKey::StorageLayoutVersion, &STORAGE_LAYOUT_VERSION);
}

pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn write_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn read_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn read_storage_layout_version(env: &Env) -> Option<u32> {
    env.storage().instance().get(&DataKey::StorageLayoutVersion)
}

pub fn read_next_session_sequence(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextSessionSequence)
        .unwrap_or(0)
}

pub fn take_next_session_sequence(env: &Env) -> u64 {
    let sequence = read_next_session_sequence(env);
    env.storage()
        .instance()
        .set(&DataKey::NextSessionSequence, &(sequence + 1));
    sequence
}

pub fn write_session(env: &Env, session: &Session) {
    env.storage()
        .persistent()
        .set(&DataKey::Session(session.id.clone()), session);
}

pub fn read_session(env: &Env, session_id: &BytesN<32>) -> Option<Session> {
    env.storage()
        .persistent()
        .get(&DataKey::Session(session_id.clone()))
}

pub fn has_session(env: &Env, session_id: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Session(session_id.clone()))
}

pub fn extend_session_ttl(env: &Env, session_id: &BytesN<32>) -> Result<(), ()> {
    // Extend the TTL of the session storage entry
    // This resets the entry's expiration clock to TTL_EXTENSION_AMOUNT ledgers
    if let Some(session) = read_session(env, session_id) {
        // Only extend TTL for open or cancelled sessions, not settled ones
        match session.status {
            crate::SessionStatus::Open | crate::SessionStatus::Cancelled => {
                // Bump the entry to extend its TTL
                env.storage()
                    .persistent()
                    .bump(&DataKey::Session(session_id.clone()), TTL_EXTENSION_AMOUNT);
                Ok(())
            }
            crate::SessionStatus::Settled => Err(()),
        }
    } else {
        Err(())
    }
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use crate::SessionStatus;
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

    fn sample_session(env: &Env) -> Session {
        let id = BytesN::from_array(env, &[1; 32]);
        Session {
            id,
            buyer: Address::generate(env),
            seller: Address::generate(env),
            asset: Address::generate(env),
            max_amount: 100,
            settled_amount: 0,
            expires_at_ledger: 50,
            resource_hash: BytesN::from_array(env, &[2; 32]),
            usage_hash: None,
            status: SessionStatus::Open,
        }
    }

    #[test]
    fn storage_layout_version_round_trips() {
        let env = Env::default();
        let contract_id = env.register(crate::UptoSessionContract, ());

        env.as_contract(&contract_id, || {
            assert_eq!(read_storage_layout_version(&env), None);
            write_storage_layout_version(&env);

            assert_eq!(
                read_storage_layout_version(&env),
                Some(STORAGE_LAYOUT_VERSION)
            );
        });
    }

    #[test]
    fn session_sequence_increments() {
        let env = Env::default();
        let contract_id = env.register(crate::UptoSessionContract, ());

        env.as_contract(&contract_id, || {
            assert_eq!(take_next_session_sequence(&env), 0);
            assert_eq!(take_next_session_sequence(&env), 1);
            assert_eq!(read_next_session_sequence(&env), 2);
        });
    }

    #[test]
    fn session_state_round_trips() {
        let env = Env::default();
        let contract_id = env.register(crate::UptoSessionContract, ());

        env.as_contract(&contract_id, || {
            let session = sample_session(&env);

            assert!(!has_session(&env, &session.id));
            write_session(&env, &session);

            assert!(has_session(&env, &session.id));
            assert_eq!(read_session(&env, &session.id), Some(session));
        });
    }
}
