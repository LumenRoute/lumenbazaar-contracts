//! Fixed-layout decoding of fuzz bytes. Every field sits at a fixed offset and reads as zero when
//! the input is shorter, and selector value 0 always means "a valid default". A short or empty
//! input is therefore a valid call, and each nonzero byte turns one field into a boundary or
//! malformed value.

use soroban_sdk::{
    xdr::{AccountId, ContractId, Hash, PublicKey, ScAddress, Uint256},
    Address, BytesN, Env, TryFromVal,
};

pub struct Input<'a> {
    data: &'a [u8],
}

impl<'a> Input<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data }
    }

    pub fn u8(&self, offset: usize) -> u8 {
        self.data.get(offset).copied().unwrap_or(0)
    }

    pub fn array<const N: usize>(&self, offset: usize) -> [u8; N] {
        let mut out = [0; N];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = self.u8(offset + i);
        }
        out
    }

    pub fn u32(&self, offset: usize) -> u32 {
        u32::from_be_bytes(self.array(offset))
    }

    pub fn i128(&self, offset: usize) -> i128 {
        i128::from_be_bytes(self.array(offset))
    }

    /// Selector byte at `offset`, then a raw `i128` in the next 16 bytes.
    pub fn amount(&self, offset: usize, default: i128) -> i128 {
        let raw = self.i128(offset + 1);
        match self.u8(offset) % 10 {
            0 => default,
            1 => 0,
            2 => 1,
            3 => -1,
            4 => i128::MIN,
            5 => i128::MAX,
            6 => i128::MAX - 1,
            7 => i128::MIN + 1,
            8 => raw,
            _ => raw.rem_euclid(1_000_000_000) + 1,
        }
    }

    /// Selector byte at `offset`, then 32 raw bytes. Covers all-zero, all-0xFF, single-bit, and
    /// arbitrary hashes.
    pub fn hash(&self, env: &Env, offset: usize, default: u8) -> BytesN<32> {
        let raw: [u8; 32] = self.array(offset + 1);
        let bytes = match self.u8(offset) % 5 {
            0 => [default; 32],
            1 => [0; 32],
            2 => [0xFF; 32],
            3 => raw,
            _ => {
                let mut single = [0; 32];
                single[(raw[0] % 32) as usize] = 1 << (raw[1] % 8);
                single
            }
        };
        BytesN::from_array(env, &bytes)
    }
}

/// A syntactically valid contract address for arbitrary bytes. No contract exists there.
pub fn contract_address(env: &Env, bytes: [u8; 32]) -> Address {
    Address::try_from_val(env, &ScAddress::Contract(ContractId(Hash(bytes))))
        .expect("contract address")
}

/// A syntactically valid account address for arbitrary bytes. The account is never funded.
pub fn account_address(env: &Env, bytes: [u8; 32]) -> Address {
    Address::try_from_val(
        env,
        &ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(bytes)))),
    )
    .expect("account address")
}
