extern crate std;

use super::*;
use crate::adversarial::{
    AdversarialBehavior, AdversarialTokenContract, AdversarialTokenContractClient,
};
use crate::asset_probe::{
    IncompatibleContract, ProbeBehavior, ProbeTokenContract, ProbeTokenContractClient,
};
use crate::conformance::*;
use crate::decimal_matrix::{
    DecimalVariantTokenContract, DecimalVariantTokenContractClient, DECIMALS_0, DECIMALS_18,
    DECIMALS_2, DECIMALS_38, DECIMALS_7,
};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token, Address, Env, Error, IntoVal, InvokeError, Symbol,
};

/// SEP-41 conformance suite for the local test asset fixtures.
///
/// Every accepted fixture (base test token plus each decimal variant) is
/// driven through the same behavioral cases and must pass all of them. Every
/// known adversarial fixture is then driven through the same probes and must
/// fail exactly the documented case (see [`SEP41_CONFORMANCE_EXPECTATIONS`]).
/// All probes are fallible so a fixture that panics (or omits an interface
/// function) is classified instead of aborting the suite.

/// Every accepted fixture must pass all conformance cases: bounded metadata,
/// accurate balances, holder-authorized transfers, error handling, and
/// transfer atomicity.
#[test]
fn every_accepted_fixture_passes_the_conformance_suite() {
    run_accepted_cases(&register_base_token, DECIMALS_7);
    for (decimals) in [DECIMALS_0, DECIMALS_2, DECIMALS_7, DECIMALS_18, DECIMALS_38] {
        run_accepted_cases(&register_decimal_variant(decimals), decimals);
    }
}

/// Every known adversarial fixture must fail for its documented reason only.
#[test]
fn adversarial_fixtures_fail_for_documented_reasons() {
    for (label, expectation) in SEP41_CONFORMANCE_EXPECTATIONS {
        if matches!(expectation, ConformanceExpectation::Conformant) {
            continue;
        }
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);

        let asset = register_adversarial(&env, &buyer, label);

        let observed = classify_fixture(&env, &asset, &buyer, &seller);
        assert_eq!(observed, expectation);
    }
}

/// Registers the base `test-token` fixture.
fn register_base_token(env: &Env, admin: &Address) -> Address {
    let id = env.register(TestTokenContract, ());
    TestTokenContractClient::new(env, &id).initialize(admin);
    id
}

/// Registers a decimal-variant fixture at the requested precision.
fn register_decimal_variant(decimals: u32) -> fn(&Env, &Address) -> Address {
    |env: &Env, admin: &Address| -> Address {
        let id = env.register(DecimalVariantTokenContract, ());
        DecimalVariantTokenContractClient::new(env, &id).initialize(admin, &decimals);
        id
    }
}

/// Runs the full acceptance suite against a single registered fixture.
fn run_accepted_cases(register: &fn(&Env, &Address) -> Address, decimals: u32) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);

    let asset = register(&env, &admin);
    let token = token::Client::new(&env, &asset);

    // Mint a deterministic opening balance in raw units.
    mint_to(&env, &asset, &admin, &buyer, 1000);

    // 1. Metadata probes: bounded precision, non-empty bounded name/symbol.
    assert!(token.decimals() <= MAX_TOKEN_DECIMALS);
    assert!(token.name().len() > 0);
    assert!(token.name().len() <= MAX_TOKEN_NAME_BYTES);
    assert!(token.symbol().len() > 0);
    assert!(token.symbol().len() <= MAX_TOKEN_SYMBOL_BYTES);

    // 2. Balances reflect recorded state.
    assert_eq!(token.balance(&buyer), 1000);
    assert_eq!(token.balance(&seller), 0);

    // 3. Transfers require holder authorization.
    assert!(transfer(&env, &asset, &buyer, &seller, &100).is_err());

    // 4. Authorized transfers move raw units atomically.
    assert!(transfer_auth(&env, &asset, &buyer, &seller, &400).is_ok());
    assert_eq!(token.balance(&buyer), 600);
    assert_eq!(token.balance(&seller), 400);

    // 5a. Non-positive amounts are rejected and nothing moves.
    assert!(transfer_auth(&env, &asset, &buyer, &seller, &0).is_err());
    assert_eq!(token.balance(&buyer), 600);
    assert_eq!(token.balance(&seller), 400);

    // 5b. Over-draws are rejected and nothing moves.
    assert!(transfer_auth(&env, &asset, &buyer, &seller, &601).is_err());
    assert_eq!(token.balance(&buyer), 600);
    assert_eq!(token.balance(&seller), 400);

    // The fixture's precision is preserved.
    assert_eq!(token.decimals(), decimals);
}

/// Mints `amount` to `to` using the fixture's administrative client (the only
/// privileged entrypoint) with explicit authorization.
fn mint_to(env: &Env, asset: &Address, admin: &Address, to: &Address, amount: i128) {
    token::Client::new(env, asset)
        .mock_auths(&[MockAuth {
            address: admin.clone(),
            invoke: &MockAuthInvoke {
                contract: asset.clone(),
                fn_name: "mint",
                args: (to.clone(), amount).into_val(env),
                sub_invokes: &[],
            },
        }])
        .mint(to, &amount);
}

/// A fallible SEP-41 `transfer` probe. The token client has no fallible
/// variants, so the probe invokes the interface directly and treats *any*
/// rejection (abort or contract error) as failure. Returns the observable
/// result of the transfer.
fn transfer(env: &Env, asset: &Address, from: &Address, to: &Address, amount: &i128) -> Result<(), TransferFailure> {
    let result = env.try_invoke_contract::<(), Error>(
        asset,
        &symbol_short!("transfer"),
        (from.clone(), to.clone(), *amount).into_val(env),
    );
    if result.is_ok() {
        let inner = result.unwrap();
        if inner.is_err() {
            Err(TransferFailure::Rejected)
        } else {
            Ok(())
        }
    } else {
        Err(TransferFailure::Invoke)
    }
}

/// A fallible SEP-41 `transfer` probe with explicit `from` authorization.
fn transfer_auth(env: &Env, asset: &Address, from: &Address, to: &Address, amount: &i128) -> Result<(), TransferFailure> {
    env.mock_auths(&[MockAuth {
        address: from.clone(),
        invoke: &MockAuthInvoke {
            contract: asset.clone(),
            fn_name: "transfer",
            args: (from.clone(), to.clone(), *amount).into_val(env),
            sub_invokes: &[],
        },
    }]);
    transfer(env, asset, from, to, amount)
}

/// How a `transfer` probe failed, kept distinct so the conformance signature
/// records whether the token aborted or returned a contract error.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TransferFailure {
    /// The invocation never returned successfully (abort, missing function,
    /// or authorization failure).
    Invoke,
    /// The token returned a contract error.
    Rejected,
}

/// Registers and configures an adversarial fixture, returning its address.
fn register_adversarial(env: &Env, buyer: &Address, label: &str) -> Address {
    match label {
        "probe-reverting" => {
            let id = env.register(ProbeTokenContract, ());
            ProbeTokenContractClient::new(env, &id).initialize(&ProbeBehavior::Reverting);
            id
        }
        "probe-malformed" => {
            let id = env.register(ProbeTokenContract, ());
            ProbeTokenContractClient::new(env, &id).initialize(&ProbeBehavior::Malformed);
            id
        }
        "adversarial-fail-transfer" => {
            let id = env.register(AdversarialTokenContract, ());
            let client = AdversarialTokenContractClient::new(env, &id);
            client.initialize(&Address::generate(env));
            client.mint(buyer, &1000);
            client.set_behavior(&AdversarialBehavior::FailTransfer);
            id
        }
        "adversarial-false-balance" => {
            let id = env.register(AdversarialTokenContract, ());
            let client = AdversarialTokenContractClient::new(env, &id);
            client.initialize(&Address::generate(env));
            client.mint(buyer, &1000);
            client.set_behavior(&AdversarialBehavior::FalseBalance);
            id
        }
        "adversarial-partial-transfer" => {
            let id = env.register(AdversarialTokenContract, ());
            let client = AdversarialTokenContractClient::new(env, &id);
            client.initialize(&Address::generate(env));
            client.mint(buyer, &1000);
            client.set_behavior(&AdversarialBehavior::PartialTransfer);
            id
        }
        "incompatible" => env.register(IncompatibleContract, ()),
        _ => unreachable!(),
    }
}

/// Classifies the observable SEP-41 behavior of a fixture into a
/// [`ConformanceExpectation`]. Every probe is fallible so fixtures that do not
/// implement (or that panic in) a function are classified without panicking
/// the suite.
fn classify_fixture(env: &Env, asset: &Address, buyer: &Address, seller: &Address) -> ConformanceExpectation {
    // 1. Metadata surface: decimals, name, symbol.
    let decimals = probe_decimals(env, asset);
    let name = probe_name(env, asset).map_err(|_| ());
    let symbol = probe_symbol(env, asset).map_err(|_| ());

    // The incompatible fixture has none of these.
    if decimals.is_none() && name.is_none() && symbol.is_none() {
        return ConformanceExpectation::Incompatible;
    }

    // 2. Balances: any negative or panicking report is a false balance.
    let buyer_balance = probe_balance(env, asset, buyer).map_err(|_| ());
    let seller_balance = probe_balance(env, asset, seller).map_err(|_| ());
    if buyer_balance.is_none()
        || seller_balance.is_none()
        || buyer_balance.unwrap() < 0
        || seller_balance.unwrap() < 0
    {
        return ConformanceExpectation::FalseBalance;
    }

    // 3. Transfer behavior: authorized transfer must move exactly `amount`.
    let before_buyer = buyer_balance.unwrap();
    let before_seller = seller_balance.unwrap();
    let outcome = transfer_auth(env, asset, buyer, seller, &100);
    match outcome {
        Err(..) => ConformanceExpectation::FailedTransfer,
        Ok(()) => {
            let after_buyer = probe_balance(env, asset, buyer).map_err(|_| ());
            let after_seller = probe_balance(env, asset, seller).map_err(|_| ());
            if after_buyer.is_none() || after_seller.is_none() {
                ConformanceExpectation::FalseBalance
            } else {
                let moved_buyer = before_buyer - after_buyer.unwrap();
                let moved_seller = after_seller.unwrap() - before_seller;
                if moved_buyer != 100 || moved_seller != 100 {
                    ConformanceExpectation::PartialTransfer
                } else {
                    ConformanceExpectation::Conformant
                }
            }
        }
    }
}

/// Fallibly invokes `decimals()` on a fixture, classifying a panic or a
/// missing function as `None` rather than aborting the suite.
fn probe_decimals(env: &Env, asset: &Address) -> Option<u32> {
    let result = env.try_invoke_contract::<u32, Error>(
        asset,
        &Symbol::new(env, "decimals"),
        ().into_val(env),
    );
    if result.is_err() {
        None
    } else {
        result.unwrap().ok()
    }
}

/// Fallibly invokes `name()` on a fixture (see [`probe_decimals`]).
fn probe_name(env: &Env, asset: &Address) -> Result<String, InvokeError> {
    probe_string(env, asset, "name")
}

/// Fallibly invokes `symbol()` on a fixture (see [`probe_decimals`]).
fn probe_symbol(env: &Env, asset: &Address) -> Result<String, InvokeError> {
    probe_string(env, asset, "symbol")
}

/// Fallibly invokes `balance(id)` on a fixture (see [`probe_decimals`]).
fn probe_balance(env: &Env, asset: &Address, id: &Address) -> Result<i128, InvokeError> {
    let result = env.try_invoke_contract::<i128, Error>(
        asset,
        &Symbol::new(env, "balance"),
        (id.clone(),).into_val(env),
    );
    if result.is_err() {
        Err(InvokeError::Abort)
    } else if result.unwrap().is_err() {
        Err(InvokeError::Contract(u32::MAX))
    } else {
        Ok(result.unwrap().unwrap())
    }
}

/// Fallibly invokes a string-returning metadata function on a fixture.
fn probe_string(env: &Env, asset: &Address, method: &str) -> Result<String, InvokeError> {
    let result = env.try_invoke_contract::<String, Error>(
        asset,
        &Symbol::new(env, method),
        ().into_val(env),
    );
    if result.is_err() {
        Err(InvokeError::Abort)
    } else if result.unwrap().is_err() {
        Err(InvokeError::Contract(u32::MAX))
    } else {
        Ok(result.unwrap().unwrap())
    }
}
