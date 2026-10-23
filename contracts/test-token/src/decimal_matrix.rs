//! Deterministic decimal-precision variants of the local test token.
//!
//! This module is compiled only behind the opt-in `testutils` feature and is
//! never part of the default `test-token` WASM build. It exists so
//! `upto-session` lifecycle and policy boundary suites can be exercised
//! against several supported SEP-41 decimal precisions.
//!
//! Every variant behaves identically to the base token in raw units. Only the
//! `decimals()` metadata differs. The supported precisions sit within the
//! bounded probe accepted by `upto-session` asset validation (0..=38):
//!
//! - [`DECIMALS_0`]  -> 0 (whole units)
//! - [`DECIMALS_2`]  -> 2 (like most fiat-pegged assets)
//! - [`DECIMALS_7`]  -> 7 (matches the base test token)
//! - [`DECIMALS_18`] -> 18 (like many EVM-style assets)
//! - [`DECIMALS_38`] -> 38 (the maximum accepted precision)
//!
//! All amounts are stored and compared in raw integer units; no decimal
//! conversion is performed anywhere in `upto-session`.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String};

/// Far below `i128::MAX` so `DECIMALS_38` fixtures are never throttled by
/// supply accounting overflow during tests.
pub const MATRIX_MINT_CEILING: i128 = 10_000_000_000_000_000_000_000_000_000_000_000_000_000;

pub const DECIMALS_0: u32 = 0;
pub const DECIMALS_2: u32 = 2;
pub const DECIMALS_7: u32 = 7;
pub const DECIMALS_18: u32 = 18;
pub const DECIMALS_38: u32 = 38;

/// The maximum precision accepted by `upto-session` asset probes.
pub const MAX_TOKEN_DECIMALS: u32 = 38;

/// Every matrix entry: (label, decimals). Kept in a fixed order and fully
/// deterministic so session lifecycle evidence is reproducible.
pub const DECIMAL_MATRIX: &[(Symbol, u32)] = &[
    (Symbol::Zero, DECIMALS_0),
    (Symbol::Two, DECIMALS_2),
    (Symbol::Seven, DECIMALS_7),
    (Symbol::Eighteen, DECIMALS_18),
    (Symbol::ThirtyEight, DECIMALS_38),
];

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Symbol {
    Zero = 0,
    Two = 1,
    Seven = 2,
    Eighteen = 3,
    ThirtyEight = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Admin,
    Balance(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MatrixTokenError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InsufficientBalance = 4,
    BalanceOverflow = 5,
}

/// A test-only SEP-41 token whose `decimals` value is chosen at runtime from a
/// bounded set. All arithmetic is raw-unit and identical across variants.
#[contract]
pub struct DecimalVariantTokenContract;

#[contractimpl]
impl DecimalVariantTokenContract {
    pub fn initialize(env: Env, admin: Address, decimals: u32) -> Result<(), MatrixTokenError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(MatrixTokenError::AlreadyInitialized);
        }
        if decimals > MAX_TOKEN_DECIMALS {
            return Err(MatrixTokenError::InvalidAmount);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&soroban_sdk::symbol_short!("decimals"), &decimals);
        Ok(())
    }

    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), MatrixTokenError> {
        let admin = read_admin(&env)?;
        validate_positive_amount(amount)?;
        admin.require_auth();
        credit(&env, &to, amount)
    }

    pub fn transfer(
        env: Env,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), MatrixTokenError> {
        validate_positive_amount(amount)?;
        from.require_auth();
        debit(&env, &from, amount)?;
        credit(&env, &to, amount)
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        read_balance(&env, &id)
    }

    /// The fixture's configured decimal precision (bounded at initialization).
    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&soroban_sdk::symbol_short!("decimals"))
            .unwrap_or(DECIMALS_7)
    }

    pub fn name(env: Env) -> String {
        String::from_str(&env, "LumenBazaar Decimal Variant")
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "LDV")
    }

    pub fn utility_only(_env: Env) -> bool {
        true
    }
}

fn read_admin(env: &Env) -> Result<Address, MatrixTokenError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(MatrixTokenError::NotInitialized)
}

fn read_balance(env: &Env, account: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Balance(account.clone()))
        .unwrap_or(0)
}

fn write_balance(env: &Env, account: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Balance(account.clone()), &amount);
}

fn validate_positive_amount(amount: i128) -> Result<(), MatrixTokenError> {
    if amount <= 0 {
        return Err(MatrixTokenError::InvalidAmount);
    }
    Ok(())
}

fn credit(env: &Env, account: &Address, amount: i128) -> Result<(), MatrixTokenError> {
    let updated = read_balance(env, account)
        .checked_add(amount)
        .ok_or(MatrixTokenError::BalanceOverflow)?;
    write_balance(env, account, updated);
    Ok(())
}

fn debit(env: &Env, account: &Address, amount: i128) -> Result<(), MatrixTokenError> {
    let balance = read_balance(env, account);
    if balance < amount {
        return Err(MatrixTokenError::InsufficientBalance);
    }
    write_balance(env, account, balance - amount);
    Ok(())
}
