use crate::Session;
use soroban_sdk::{contractevent, Address, BytesN, Env};

#[contractevent]
pub struct SessionCreated {
    #[topic]
    pub session_id: BytesN<32>,
    pub buyer: Address,
    pub seller: Address,
    pub asset: Address,
    pub max_amount: i128,
    pub expires_at_ledger: u32,
    pub resource_hash: BytesN<32>,
}

#[contractevent]
pub struct SessionSettled {
    #[topic]
    pub session_id: BytesN<32>,
    pub seller: Address,
    pub asset: Address,
    pub actual_amount: i128,
    pub usage_hash: BytesN<32>,
}

#[contractevent]
pub struct SessionCancelled {
    #[topic]
    pub session_id: BytesN<32>,
    pub buyer: Address,
}

pub fn publish_session_created(env: &Env, session: &Session) {
    SessionCreated {
        session_id: session.id.clone(),
        buyer: session.buyer.clone(),
        seller: session.seller.clone(),
        asset: session.asset.clone(),
        max_amount: session.max_amount,
        expires_at_ledger: session.expires_at_ledger,
        resource_hash: session.resource_hash.clone(),
    }
    .publish(env);
}

pub fn publish_session_settled(
    env: &Env,
    session_id: &BytesN<32>,
    seller: &Address,
    asset: &Address,
    actual_amount: i128,
    usage_hash: &BytesN<32>,
) {
    SessionSettled {
        session_id: session_id.clone(),
        seller: seller.clone(),
        asset: asset.clone(),
        actual_amount,
        usage_hash: usage_hash.clone(),
    }
    .publish(env);
}

pub fn publish_session_cancelled(env: &Env, session_id: &BytesN<32>, buyer: &Address) {
    SessionCancelled {
        session_id: session_id.clone(),
        buyer: buyer.clone(),
    }
    .publish(env);
}
