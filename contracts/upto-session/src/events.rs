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
