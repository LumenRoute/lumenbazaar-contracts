//! `token_amount` target: the amount and cap validation helpers in `upto-session` and its checked
//! liability arithmetic, each compared with an independent statement of the rule. Byte layout is
//! in `fuzz/README.md`.

use crate::input::Input;
use crate::{DEFAULT_LEDGER, ENTRY_TTL, MAX_LEDGER};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env,
};
use upto_session::{
    storage,
    validation::{
        validate_asset_cap, validate_asset_policy, validate_cap_increase_proposal,
        validate_settlement_amount, MAX_CAP_INCREASE_DELAY_LEDGERS, MIN_CAP_INCREASE_DELAY_LEDGERS,
    },
    ContractError, Session, SessionStatus, UptoSessionContract,
};

pub fn token_amount(data: &[u8]) {
    let input = Input::new(data);
    let a = input.amount(1, 1_000);
    let b = input.amount(18, 2_000);
    let x = input.u32(35);
    let y = input.u32(39);
    let env = Env::default();
    // Pure validation accepts any ledger, including values whose additions overflow.
    let ledger = match input.u8(43) % 3 {
        0 => DEFAULT_LEDGER,
        1 => input.u32(44),
        _ => u32::MAX,
    };
    env.ledger().set_sequence_number(ledger);

    match input.u8(0) % 5 {
        0 => {
            let expected = if a > 0 {
                Ok(())
            } else {
                Err(ContractError::InvalidAssetCap)
            };
            assert_eq!(validate_asset_cap(a), expected, "asset cap {a}");
        }
        1 => {
            let expected = if b > 0 && a > 0 && a <= b {
                Ok(())
            } else {
                Err(ContractError::InvalidAssetCap)
            };
            assert_eq!(
                validate_asset_policy(a, b),
                expected,
                "policy min {a} max {b}"
            );
        }
        2 => {
            let session = Session {
                id: BytesN::from_array(&env, &[1; 32]),
                buyer: Address::generate(&env),
                seller: Address::generate(&env),
                asset: Address::generate(&env),
                max_amount: b,
                escrowed_amount: b,
                settled_amount: 0,
                expires_at_ledger: x,
                resource_hash: BytesN::from_array(&env, &[2; 32]),
                usage_hash: None,
                status: SessionStatus::Open,
                creation_ledger: 0,
                finalized_ledger: None,
                resource_scheme_version: 1,
                usage_scheme_version: None,
            };
            let expected = if a <= 0 {
                Err(ContractError::InvalidAmount)
            } else if a > b {
                Err(ContractError::AmountExceedsCap)
            } else if ledger >= x {
                Err(ContractError::ExpiredSession)
            } else {
                Ok(())
            };
            assert_eq!(
                validate_settlement_amount(&env, &session, a),
                expected,
                "settle {a} under cap {b}, expiry {x}, ledger {ledger}"
            );
        }
        3 => liability(&env, a, b, ledger),
        _ => {
            let expected = expected_cap_increase(a, b, x, y, ledger);
            assert_eq!(
                validate_cap_increase_proposal(&env, a, b, x, y),
                expected,
                "cap increase {a} -> {b}, active {x}, expires {y}, ledger {ledger}"
            );
        }
    }
}

fn expected_cap_increase(
    current: i128,
    proposed: i128,
    active: u32,
    expires: u32,
    ledger: u32,
) -> Result<(), ContractError> {
    let invalid_delay = Err(ContractError::InvalidCapIncreaseDelay);
    if proposed <= 0 || proposed <= current {
        return Err(ContractError::InvalidAssetCap);
    }
    let (Some(min_active), Some(max_active)) = (
        ledger.checked_add(MIN_CAP_INCREASE_DELAY_LEDGERS),
        ledger.checked_add(MAX_CAP_INCREASE_DELAY_LEDGERS),
    ) else {
        return invalid_delay;
    };
    if active < min_active || active > max_active || expires <= active {
        return invalid_delay;
    }
    match active.checked_add(MAX_CAP_INCREASE_DELAY_LEDGERS) {
        Some(max_expiry) if expires <= max_expiry => Ok(()),
        _ => invalid_delay,
    }
}

/// Liability accounting: add `a`, subtract `b`, add `b` again. Every step must equal checked
/// arithmetic, never go negative on subtraction, and leave the stored value unchanged on error.
fn liability(env: &Env, a: i128, b: i128, ledger: u32) {
    env.ledger().set_sequence_number(ledger % MAX_LEDGER);
    env.ledger().set_min_persistent_entry_ttl(ENTRY_TTL);
    let contract = env.register(UptoSessionContract, ());
    let asset = Address::generate(env);
    env.as_contract(&contract, || {
        let mut model: i128 = 0;
        let steps: [(bool, i128); 3] = [(true, a), (false, b), (true, b)];
        for (increase, amount) in steps {
            let (result, expected) = if increase {
                (
                    storage::increase_liability(env, &asset, amount),
                    model
                        .checked_add(amount)
                        .ok_or(ContractError::LiabilityOverflow),
                )
            } else {
                (
                    storage::decrease_liability(env, &asset, amount),
                    model
                        .checked_sub(amount)
                        .filter(|value| *value >= 0)
                        .ok_or(ContractError::LiabilityUnderflow),
                )
            };
            assert_eq!(result, expected, "liability {model} {increase} {amount}");
            if let Ok(value) = expected {
                model = value;
            }
            assert_eq!(storage::read_liability(env, &asset), model);
        }
    });
}
