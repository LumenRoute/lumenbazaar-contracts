//! SEP-41 conformance suite for local test asset fixtures.
//!
//! This module is compiled only behind the opt-in `testutils` feature and is
//! never part of the default `test-token` WASM build. It defines the shared,
//! network-free behavioral contract every accepted fixture must satisfy and
//! documents the exact reason each known adversarial fixture fails.
//!
//! The runnable checks live in `conformance_test.rs` (included from
//! `crate::test`), which drives the same behavioral suite for every fixture:
//! the base `TestTokenContract`, every decimal-variant fixture, and each
//! adversarial fixture.
//!
//! Covered SEP-41 subset (the surface `upto-session` probes and exercises):
//!
//! - `decimals()` stays within the bounded precision probe (0..=38).
//! - `name()` and `symbol()` are non-empty and length-bounded.
//! - `balance(id)` reflects minted funds and never reports negative values.
//! - `transfer(from, to, amount)` requires holder authorization, rejects
//!   non-positive amounts and over-draws, and moves funds atomically.
//!
//! No fixture in this suite requires network access; everything runs against
//! the in-process test host.

/// The bounded maximum decimals value accepted by `upto-session` asset probes.
pub const MAX_TOKEN_DECIMALS: u32 = 38;

/// Upper bound mirrored from the `upto-session` name probe.
pub const MAX_TOKEN_NAME_BYTES: u32 = 64;

/// Upper bound mirrored from the `upto-session` symbol probe.
pub const MAX_TOKEN_SYMBOL_BYTES: u32 = 12;

/// Whether a fixture is an accepted token (must pass every conformance case)
/// or an adversarial fixture (must fail a documented case).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConformanceExpectation {
    /// Passes every case in the suite.
    Conformant,
    /// Reverts or reports a failure for a transfer it cannot honor.
    FailedTransfer,
    /// Reports balances that do not reflect recorded mint/transfer state.
    FalseBalance,
    /// Moves a different amount than the requested transfer amount.
    PartialTransfer,
    /// Does not implement the SEP-41 surface at all.
    Incompatible,
}

/// Deterministic, documented expectations for every fixture the suite covers.
///
/// The labels match the fixture registration used by `conformance_test.rs`,
/// so security reviews can cite the exact reason a fixture is or is not
/// accepted.
pub const SEP41_CONFORMANCE_EXPECTATIONS: &[(&str, ConformanceExpectation)] = &[
    ("test-token", ConformanceExpectation::Conformant),
    ("decimal-variant-0", ConformanceExpectation::Conformant),
    ("decimal-variant-2", ConformanceExpectation::Conformant),
    ("decimal-variant-7", ConformanceExpectation::Conformant),
    ("decimal-variant-18", ConformanceExpectation::Conformant),
    ("decimal-variant-38", ConformanceExpectation::Conformant),
    ("probe-reverting", ConformanceExpectation::FailedTransfer),
    ("probe-malformed", ConformanceExpectation::FalseBalance),
    ("adversarial-fail-transfer", ConformanceExpectation::FailedTransfer),
    ("adversarial-false-balance", ConformanceExpectation::FalseBalance),
    ("adversarial-partial-transfer", ConformanceExpectation::PartialTransfer),
    ("incompatible", ConformanceExpectation::Incompatible),
];
