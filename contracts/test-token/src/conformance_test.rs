extern crate std;

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
use crate::{TestTokenContract, TestTokenContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token, Address, Env, Error, IntoVal, InvokeError, String, Symbol,
};

/// SEP-41 conformance suite for the local test asset fixtures.
///
/// Every accepted fixture (base test token plus each decimal variant) is
/// driven through the same behavioral cases and must pass all of them. Every
/// known adversarial fixture is then driven through the same probes and must
/// fail exactly the documented case (see [`SEP41_CONFORMANCE_EXPECTATIONS`]).
/// All probes are fallible so a fixture that panics (or omits an interface
/// function) is classified instead of aborting the suite.
///
/// Every accepted fixture must pass all conformance cases: bounded metadata,
/// accurate balances, holder-authorized transfers, error handling, and
/// transfer atomicity.
#[test]
fn every_accepted_fixture_passes_the_conformance_suite() {
    run_accepted_cases(register_base_token, DECIMALS_7);
    for decimals in [DECIMALS_0, DECIMALS_2, DECIMALS_7, DECIMALS_18, DECIMALS_38] {
        run_accepted_cases(
            |env, admin| register_decimal_variant(env, admin, decimals),
            decimals,
        );
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
        assert_eq!(observed, *expectation, "fixture: {label}");
    }
}

/// Registers the base `test-token` fixture.
fn register_base_token(env: &Env, admin: &Address) -> Address {
    let id = env.register(TestTokenContract, ());
    TestTokenContractClient::new(env, &id).initialize(admin);
    id
}

/// Registers a decimal-variant fixture at the requested precision.
fn register_decimal_variant(env: &Env, admin: &Address, decimals: u32) -> Address {
    let id = env.register(DecimalVariantTokenContract, ());
    DecimalVariantTokenContractClient::new(env, &id).initialize(admin, &decimals);
    id
}

/// Runs the full acceptance suite against a single registered fixture.
fn run_accepted_cases(register: impl Fn(&Env, &Address) -> Address, decimals: u32) {
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
    assert!(!token.name().is_empty());
    assert!(token.name().len() <= MAX_TOKEN_NAME_BYTES);
    assert!(!token.symbol().is_empty());
    assert!(token.symbol().len() <= MAX_TOKEN_SYMBOL_BYTES);

    // 2. Balances reflect recorded state.
    assert_eq!(token.balance(&buyer), 1000);
    assert_eq!(token.balance(&seller), 0);

    // 3. Transfers require holder authorization.
    env.mock_auths(&[]);
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
    token::StellarAssetClient::new(env, asset)
        .mock_auths(&[MockAuth {
            address: admin,
            invoke: &MockAuthInvoke {
                contract: asset,
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
fn transfer(
    env: &Env,
    asset: &Address,
    from: &Address,
    to: &Address,
    amount: &i128,
) -> Result<(), TransferFailure> {
    let result = env.try_invoke_contract::<(), Error>(
        asset,
        &symbol_short!("transfer"),
        (from.clone(), to.clone(), *amount).into_val(env),
    );
    match result {
        Ok(Ok(())) => Ok(()),
        Err(Ok(_)) => Err(TransferFailure::Rejected),
        Ok(Err(_)) | Err(Err(_)) => Err(TransferFailure::Invoke),
    }
}

/// A fallible SEP-41 `transfer` probe with explicit `from` authorization.
fn transfer_auth(
    env: &Env,
    asset: &Address,
    from: &Address,
    to: &Address,
    amount: &i128,
) -> Result<(), TransferFailure> {
    env.mock_auths(&[MockAuth {
        address: from,
        invoke: &MockAuthInvoke {
            contract: asset,
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
fn classify_fixture(
    env: &Env,
    asset: &Address,
    buyer: &Address,
    seller: &Address,
) -> ConformanceExpectation {
    // 1. Metadata surface: decimals, name, symbol.
    let decimals = probe_decimals(env, asset);
    let name = probe_name(env, asset);
    let symbol = probe_symbol(env, asset);

    if matches!(decimals, Err(InvokeError::Contract(_))) {
        return ConformanceExpectation::FailedTransfer;
    }

    // The incompatible fixture has none of these.
    if decimals.is_err() && name.is_err() && symbol.is_err() {
        return ConformanceExpectation::Incompatible;
    }

    // 2. Balances must match the deterministic mint performed during setup.
    let (Ok(before_buyer), Ok(before_seller)) = (
        probe_balance(env, asset, buyer),
        probe_balance(env, asset, seller),
    ) else {
        return ConformanceExpectation::FalseBalance;
    };
    if before_buyer != 1000 || before_seller != 0 {
        return ConformanceExpectation::FalseBalance;
    }

    // 3. Transfer behavior: authorized transfer must move exactly `amount`.
    let outcome = transfer_auth(env, asset, buyer, seller, &100);
    match outcome {
        Err(..) => ConformanceExpectation::FailedTransfer,
        Ok(()) => {
            let (Ok(after_buyer), Ok(after_seller)) = (
                probe_balance(env, asset, buyer),
                probe_balance(env, asset, seller),
            ) else {
                return ConformanceExpectation::FalseBalance;
            };
            let moved_buyer = before_buyer - after_buyer;
            let moved_seller = after_seller - before_seller;
            if moved_buyer != 100 || moved_seller != 100 {
                ConformanceExpectation::PartialTransfer
            } else {
                ConformanceExpectation::Conformant
            }
        }
    }
}

/// Fallibly invokes `decimals()` on a fixture, classifying a panic or a
/// missing function as an error rather than aborting the suite.
fn probe_decimals(env: &Env, asset: &Address) -> Result<u32, InvokeError> {
    let result = env.try_invoke_contract::<u32, Error>(
        asset,
        &Symbol::new(env, "decimals"),
        ().into_val(env),
    );
    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err(InvokeError::Abort),
        Err(Ok(error)) => Err(error.into()),
        Err(Err(error)) => Err(error),
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
    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err(InvokeError::Abort),
        Err(Ok(error)) => Err(error.into()),
        Err(Err(error)) => Err(error),
    }
}

/// Fallibly invokes a string-returning metadata function on a fixture.
fn probe_string(env: &Env, asset: &Address, method: &str) -> Result<String, InvokeError> {
    let result = env.try_invoke_contract::<String, Error>(
        asset,
        &Symbol::new(env, method),
        ().into_val(env),
    );
    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err(InvokeError::Abort),
        Err(Ok(error)) => Err(error.into()),
        Err(Err(error)) => Err(error),
    }
}
