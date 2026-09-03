use soroban_sdk::{xdr::ToXdr, Address, BytesN, Env};

pub struct SessionIdInput<'a> {
    pub buyer: &'a Address,
    pub seller: &'a Address,
    pub asset: &'a Address,
    pub max_amount: i128,
    pub expires_at_ledger: u32,
    pub resource_hash: &'a BytesN<32>,
    pub sequence: u64,
}

pub fn derive_session_id(env: &Env, input: &SessionIdInput<'_>) -> BytesN<32> {
    let preimage = (
        input.buyer.clone(),
        input.seller.clone(),
        input.asset.clone(),
        input.max_amount,
        input.expires_at_ledger,
        input.resource_hash.clone(),
        input.sequence,
    )
        .to_xdr(env);

    env.crypto().sha256(&preimage).to_bytes()
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{testutils::Address as _, Address};

    #[test]
    fn sequence_changes_session_id_for_identical_inputs() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let asset = Address::generate(&env);
        let resource_hash = BytesN::from_array(&env, &[9; 32]);

        let first = derive_session_id(
            &env,
            &SessionIdInput {
                buyer: &buyer,
                seller: &seller,
                asset: &asset,
                max_amount: 100,
                expires_at_ledger: 50,
                resource_hash: &resource_hash,
                sequence: 0,
            },
        );
        let second = derive_session_id(
            &env,
            &SessionIdInput {
                buyer: &buyer,
                seller: &seller,
                asset: &asset,
                max_amount: 100,
                expires_at_ledger: 50,
                resource_hash: &resource_hash,
                sequence: 1,
            },
        );

        assert_ne!(first, second);
    }

    #[test]
    fn changing_bound_fields_changes_session_id() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let other_seller = Address::generate(&env);
        let asset = Address::generate(&env);
        let resource_hash = BytesN::from_array(&env, &[9; 32]);

        let first = derive_session_id(
            &env,
            &SessionIdInput {
                buyer: &buyer,
                seller: &seller,
                asset: &asset,
                max_amount: 100,
                expires_at_ledger: 50,
                resource_hash: &resource_hash,
                sequence: 0,
            },
        );
        let second = derive_session_id(
            &env,
            &SessionIdInput {
                buyer: &buyer,
                seller: &other_seller,
                asset: &asset,
                max_amount: 100,
                expires_at_ledger: 50,
                resource_hash: &resource_hash,
                sequence: 0,
            },
        );

        assert_ne!(first, second);
    }
}
