//! Bounded stateful fuzz target for multi-asset session interleaving against `upto-session`.
//!
//! Alternates session creation, settlement, cancellation, expired recovery, ledger advancement,
//! per-asset cap transitions (decreases and delayed cap-increase proposals/acceptances), and
//! pause/resume operational state transitions across three configured Stellar assets.
//!
//! After every step the harness verifies:
//! 1. Every contract call returns `Ok` or a defined `ContractError` (never a host trap).
//! 2. The call succeeds if and only if the independent model says it is valid.
//! 3. Strict per-asset isolation: liabilities, escrow balances, buyer/seller balances, and caps
//!    for untouched assets never change.
//! 4. Total liabilities across all assets always equal the exact sum of escrowed amounts of open
//!    sessions, and every asset's escrow token balance equals its recorded liability.
//!
//! Byte layout is documented in `fuzz/README.md`.

use crate::{defined, DEFAULT_LEDGER, ENTRY_TTL, MAX_LEDGER};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec, Address, BytesN, Env,
};
use upto_session::{
    validation::MIN_CAP_INCREASE_DELAY_LEDGERS, AssetPolicy, OperationalState, SessionStatus,
    UptoSessionContract, UptoSessionContractClient,
};

const ASSET_COUNT: usize = 3;
const BUYER_COUNT: usize = 2;
const SELLER_COUNT: usize = 2;
const INITIAL_BALANCE: i128 = 1_000_000;
const INITIAL_CAPS: [i128; ASSET_COUNT] = [1_000, 2_500, 5_000];
const MAX_ASSET_EXPOSURE: i128 = 100_000;
const MAX_BUYER_EXPOSURE: i128 = 50_000;
const STEP_BYTES: usize = 8;
const MAX_STEPS: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CapProposal {
    proposed_max: i128,
    active_at: u32,
    expires_at: u32,
}

#[derive(Clone)]
struct TrackedSession {
    id: BytesN<32>,
    asset_idx: usize,
    buyer_idx: usize,
    seller_idx: usize,
    max_amount: i128,
    expires_at: u32,
    status: SessionStatus,
}

struct MultiAssetHarness {
    env: Env,
    contract: Address,
    assets: [Address; ASSET_COUNT],
    buyers: [Address; BUYER_COUNT],
    sellers: [Address; SELLER_COUNT],
    caps: [i128; ASSET_COUNT],
    proposals: [Option<CapProposal>; ASSET_COUNT],
    liability: [i128; ASSET_COUNT],
    buyer_exposure: [[i128; ASSET_COUNT]; BUYER_COUNT],
    buyer_bal: [[i128; ASSET_COUNT]; BUYER_COUNT],
    seller_bal: [[i128; ASSET_COUNT]; SELLER_COUNT],
    op_state: OperationalState,
    sessions: Vec<TrackedSession>,
    nonce: u32,
}

impl MultiAssetHarness {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().set_sequence_number(DEFAULT_LEDGER);
        env.ledger().set_min_persistent_entry_ttl(ENTRY_TTL);

        let contract = env.register(UptoSessionContract, ());
        let admin = Address::generate(&env);
        let buyers = [Address::generate(&env), Address::generate(&env)];
        let sellers = [Address::generate(&env), Address::generate(&env)];
        let assets = [
            env.register_stellar_asset_contract_v2(Address::generate(&env))
                .address(),
            env.register_stellar_asset_contract_v2(Address::generate(&env))
                .address(),
            env.register_stellar_asset_contract_v2(Address::generate(&env))
                .address(),
        ];

        for asset in &assets {
            let mint = token::StellarAssetClient::new(&env, asset);
            for buyer in &buyers {
                mint.mint(buyer, &INITIAL_BALANCE);
            }
        }

        let policies = vec![
            &env,
            AssetPolicy {
                asset: assets[0].clone(),
                max_session_amount: INITIAL_CAPS[0],
                min_session_amount: 1,
                max_asset_exposure: MAX_ASSET_EXPOSURE,
                max_buyer_exposure: MAX_BUYER_EXPOSURE,
            },
            AssetPolicy {
                asset: assets[1].clone(),
                max_session_amount: INITIAL_CAPS[1],
                min_session_amount: 1,
                max_asset_exposure: MAX_ASSET_EXPOSURE,
                max_buyer_exposure: MAX_BUYER_EXPOSURE,
            },
            AssetPolicy {
                asset: assets[2].clone(),
                max_session_amount: INITIAL_CAPS[2],
                min_session_amount: 1,
                max_asset_exposure: MAX_ASSET_EXPOSURE,
                max_buyer_exposure: MAX_BUYER_EXPOSURE,
            },
        ];
        UptoSessionContractClient::new(&env, &contract).initialize(&admin, &policies);

        Self {
            env,
            contract,
            assets,
            buyers,
            sellers,
            caps: INITIAL_CAPS,
            proposals: [None; ASSET_COUNT],
            liability: [0; ASSET_COUNT],
            buyer_exposure: [[0; ASSET_COUNT]; BUYER_COUNT],
            buyer_bal: [[INITIAL_BALANCE; ASSET_COUNT]; BUYER_COUNT],
            seller_bal: [[0; ASSET_COUNT]; SELLER_COUNT],
            op_state: OperationalState::Active,
            sessions: Vec::new(),
            nonce: 1,
        }
    }

    fn client(&self) -> UptoSessionContractClient<'_> {
        UptoSessionContractClient::new(&self.env, &self.contract)
    }

    fn next_hash(&mut self, tag: u8) -> BytesN<32> {
        let mut raw = [0u8; 32];
        raw[0] = tag.max(1);
        raw[1..5].copy_from_slice(&self.nonce.to_be_bytes());
        self.nonce = self.nonce.wrapping_add(1);
        BytesN::from_array(&self.env, &raw)
    }

    /// Verifies strict per-asset isolation, total liabilities, caps, and operational state.
    fn assert_invariants(&self, step: usize, check_party_balances: bool) {
        let mut total_on_chain_liability: i128 = 0;
        let mut total_open_escrow: i128 = 0;

        for a in 0..ASSET_COUNT {
            let asset = &self.assets[a];
            let token_client = token::Client::new(&self.env, asset);

            let (on_chain_liability, on_chain_cap) = self.env.as_contract(&self.contract, || {
                (
                    upto_session::storage::read_liability(&self.env, asset),
                    upto_session::storage::read_asset_max_session_amount(&self.env, asset)
                        .expect("configured asset cap"),
                )
            });
            let on_chain_escrow = token_client.balance(&self.contract);
            let expected_open_for_asset: i128 = self
                .sessions
                .iter()
                .filter(|s| s.asset_idx == a && s.status == SessionStatus::Open)
                .map(|s| s.max_amount)
                .sum();

            assert_eq!(
                on_chain_liability, self.liability[a],
                "step {step}: asset {a} liability diverged from model"
            );
            assert_eq!(
                on_chain_liability, expected_open_for_asset,
                "step {step}: asset {a} liability != sum of open sessions"
            );
            assert_eq!(
                on_chain_escrow, self.liability[a],
                "step {step}: asset {a} escrow token balance != liability"
            );
            assert_eq!(
                on_chain_cap, self.caps[a],
                "step {step}: asset {a} cap diverged from model"
            );

            if check_party_balances {
                for b in 0..BUYER_COUNT {
                    assert_eq!(
                        token_client.balance(&self.buyers[b]),
                        self.buyer_bal[b][a],
                        "step {step}: buyer {b} balance for asset {a} diverged"
                    );
                }
                for s in 0..SELLER_COUNT {
                    assert_eq!(
                        token_client.balance(&self.sellers[s]),
                        self.seller_bal[s][a],
                        "step {step}: seller {s} balance for asset {a} diverged"
                    );
                }
            }

            total_on_chain_liability += on_chain_liability;
            total_open_escrow += expected_open_for_asset;
        }

        assert_eq!(
            total_on_chain_liability, total_open_escrow,
            "step {step}: total liabilities across assets != sum of open session escrows"
        );
        let on_chain_op_state = self.env.as_contract(&self.contract, || {
            upto_session::storage::read_operational_state(&self.env)
        });
        assert_eq!(
            on_chain_op_state, self.op_state,
            "step {step}: operational state diverged from model"
        );
    }

    fn step_create(&mut self, bytes: &[u8; STEP_BYTES]) {
        let a = usize::from(bytes[1]) % ASSET_COUNT;
        let b = usize::from(bytes[2]) % BUYER_COUNT;
        let s = usize::from(bytes[3]) % SELLER_COUNT;
        let cap = self.caps[a];
        let raw_amt = i128::from(u16::from_be_bytes([bytes[4], bytes[5]]));
        let amount = match bytes[6] % 6 {
            0 => (raw_amt % cap.max(1)) + 1,
            1 => 1,
            2 => cap,
            3 => cap + 1,
            4 => 0,
            _ => (raw_amt % 500) + 1,
        };
        let duration = match bytes[7] % 5 {
            0 => 50,
            1 => 150,
            2 => 300,
            3 => 10,
            _ => 0,
        };
        let ledger = self.env.ledger().sequence();
        let expires_at = ledger.saturating_add(duration);
        let resource_hash = self.next_hash(0x11);
        let idempotency_key = self.next_hash(0x22);

        let expected_ok = self.op_state == OperationalState::Active
            && amount >= 1
            && amount <= cap
            && duration > 0
            && self.liability[a] + amount <= MAX_ASSET_EXPOSURE
            && self.buyer_exposure[b][a] + amount <= MAX_BUYER_EXPOSURE
            && self.buyer_bal[b][a] >= amount;

        let result = defined(self.client().try_create_session(
            &self.buyers[b],
            &self.sellers[s],
            &self.assets[a],
            &amount,
            &expires_at,
            &resource_hash,
            &idempotency_key,
        ));

        match (result, expected_ok) {
            (Ok(id), true) => {
                self.liability[a] += amount;
                self.buyer_exposure[b][a] += amount;
                self.buyer_bal[b][a] -= amount;
                self.sessions.push(TrackedSession {
                    id,
                    asset_idx: a,
                    buyer_idx: b,
                    seller_idx: s,
                    max_amount: amount,
                    expires_at,
                    status: SessionStatus::Open,
                });
            }
            (Ok(_), false) => panic!("validation bypass: create_session accepted invalid input"),
            (Err(err), true) => panic!("valid create_session rejected with {err:?}"),
            (Err(_), false) => {}
        }
    }

    fn step_settle(&mut self, bytes: &[u8; STEP_BYTES]) {
        if self.sessions.is_empty() {
            return;
        }
        let idx = usize::from(bytes[1]) % self.sessions.len();
        let session = self.sessions[idx].clone();
        let raw_amt = i128::from(u16::from_be_bytes([bytes[2], bytes[3]]));
        let actual_amount = match bytes[4] % 5 {
            0 => (raw_amt % session.max_amount.max(1)) + 1,
            1 => 1,
            2 => session.max_amount,
            3 => session.max_amount + 1,
            _ => 0,
        };
        let usage_hash = self.next_hash(0x33);
        let ledger = self.env.ledger().sequence();

        let expected_ok = session.status == SessionStatus::Open
            && ledger < session.expires_at
            && actual_amount >= 1
            && actual_amount <= session.max_amount;

        let result = defined(
            self.client()
                .try_settle(&session.id, &actual_amount, &usage_hash),
        );

        match (result, expected_ok) {
            (Ok(()), true) => {
                let refund = session.max_amount - actual_amount;
                self.liability[session.asset_idx] -= session.max_amount;
                self.buyer_exposure[session.buyer_idx][session.asset_idx] -= session.max_amount;
                self.seller_bal[session.seller_idx][session.asset_idx] += actual_amount;
                self.buyer_bal[session.buyer_idx][session.asset_idx] += refund;
                self.sessions[idx].status = SessionStatus::Settled;
            }
            (Ok(()), false) => panic!("validation bypass: settle accepted invalid input"),
            (Err(err), true) => panic!("valid settle rejected with {err:?}"),
            (Err(_), false) => {}
        }
    }

    fn step_cancel(&mut self, bytes: &[u8; STEP_BYTES]) {
        if self.sessions.is_empty() {
            return;
        }
        let idx = usize::from(bytes[1]) % self.sessions.len();
        let session = self.sessions[idx].clone();
        let ledger = self.env.ledger().sequence();

        let expected_ok = session.status == SessionStatus::Open && ledger < session.expires_at;
        let result = defined(self.client().try_cancel(&session.id));

        match (result, expected_ok) {
            (Ok(()), true) => {
                self.liability[session.asset_idx] -= session.max_amount;
                self.buyer_exposure[session.buyer_idx][session.asset_idx] -= session.max_amount;
                self.buyer_bal[session.buyer_idx][session.asset_idx] += session.max_amount;
                self.sessions[idx].status = SessionStatus::Cancelled;
            }
            (Ok(()), false) => panic!("validation bypass: cancel accepted invalid input"),
            (Err(err), true) => panic!("valid cancel rejected with {err:?}"),
            (Err(_), false) => {}
        }
    }

    fn step_recover(&mut self, bytes: &[u8; STEP_BYTES]) {
        if self.sessions.is_empty() {
            return;
        }
        let idx = usize::from(bytes[1]) % self.sessions.len();
        let session = self.sessions[idx].clone();
        let ledger = self.env.ledger().sequence();

        let expected_ok = session.status == SessionStatus::Open && ledger >= session.expires_at;
        let result = defined(self.client().try_recover_expired(&session.id));

        match (result, expected_ok) {
            (Ok(()), true) => {
                self.liability[session.asset_idx] -= session.max_amount;
                self.buyer_exposure[session.buyer_idx][session.asset_idx] -= session.max_amount;
                self.buyer_bal[session.buyer_idx][session.asset_idx] += session.max_amount;
                self.sessions[idx].status = SessionStatus::Expired;
            }
            (Ok(()), false) => panic!("validation bypass: recover_expired accepted invalid input"),
            (Err(err), true) => panic!("valid recover_expired rejected with {err:?}"),
            (Err(_), false) => {}
        }
    }

    fn step_advance_ledger(&mut self, bytes: &[u8; STEP_BYTES]) {
        let delta: u32 = match bytes[1] % 6 {
            0 => 1,
            1 => 10,
            2 => 50,
            3 => MIN_CAP_INCREASE_DELAY_LEDGERS,
            4 => 250,
            _ => 500,
        };
        let next = self
            .env
            .ledger()
            .sequence()
            .saturating_add(delta)
            .min(MAX_LEDGER);
        self.env.ledger().set_sequence_number(next);
    }

    fn step_cap_decrease(&mut self, bytes: &[u8; STEP_BYTES]) {
        let a = usize::from(bytes[1]) % ASSET_COUNT;
        let current = self.caps[a];
        let new_cap = match bytes[2] % 5 {
            0 => (current / 2).max(1),
            1 => 1,
            2 => current,
            3 => current + 500, // Rejected: increases require proposal.
            _ => 0,             // Rejected: non-positive cap.
        };

        let expected_ok = new_cap >= 1 && new_cap <= current;
        let result = defined(
            self.client()
                .try_set_asset_max_session_amount(&self.assets[a], &new_cap),
        );

        match (result, expected_ok) {
            (Ok(()), true) => self.caps[a] = new_cap,
            (Ok(()), false) => {
                panic!("validation bypass: set_asset_max_session_amount accepted invalid cap")
            }
            (Err(err), true) => {
                panic!("valid set_asset_max_session_amount rejected with {err:?}")
            }
            (Err(_), false) => {}
        }
    }

    fn step_cap_increase_transition(&mut self, bytes: &[u8; STEP_BYTES]) {
        let a = usize::from(bytes[1]) % ASSET_COUNT;
        let ledger = self.env.ledger().sequence();

        if let Some(proposal) = self.proposals[a] {
            let expected_ok = ledger >= proposal.active_at && ledger < proposal.expires_at;
            let result = defined(self.client().try_accept_asset_cap_increase(&self.assets[a]));
            match (result, expected_ok) {
                (Ok(()), true) => {
                    self.caps[a] = proposal.proposed_max;
                    self.proposals[a] = None;
                }
                (Ok(()), false) => {
                    panic!("validation bypass: accept_asset_cap_increase accepted outside window")
                }
                (Err(err), true) => {
                    panic!("valid accept_asset_cap_increase rejected with {err:?}")
                }
                (Err(_), false) => {
                    if ledger >= proposal.expires_at {
                        // Contract does not auto-clear expired proposals on accept, so keep tracking.
                    }
                }
            }
        } else {
            let increase = i128::from((u16::from(bytes[2]) % 10) + 1) * 500;
            let proposed_max = self.caps[a] + increase;
            let active_at = ledger.saturating_add(MIN_CAP_INCREASE_DELAY_LEDGERS);
            let expires_at = active_at.saturating_add(1_000);

            let result = defined(self.client().try_propose_asset_cap_increase(
                &self.assets[a],
                &proposed_max,
                &active_at,
                &expires_at,
            ));
            match result {
                Ok(()) => {
                    self.proposals[a] = Some(CapProposal {
                        proposed_max,
                        active_at,
                        expires_at,
                    });
                }
                Err(err) => panic!("valid propose_asset_cap_increase rejected with {err:?}"),
            }
        }
    }

    fn step_pause_transition(&mut self, bytes: &[u8; STEP_BYTES]) {
        if bytes[1].is_multiple_of(2) {
            let expected_ok = self.op_state == OperationalState::Active;
            let result = defined(self.client().try_pause_creation());
            match (result, expected_ok) {
                (Ok(()), true) => self.op_state = OperationalState::Paused,
                (Ok(()), false) => {
                    panic!("validation bypass: pause_creation succeeded when not Active")
                }
                (Err(err), true) => panic!("valid pause_creation rejected with {err:?}"),
                (Err(_), false) => {}
            }
        } else {
            let expected_ok = self.op_state == OperationalState::Paused;
            let result = defined(self.client().try_resume_creation());
            match (result, expected_ok) {
                (Ok(()), true) => self.op_state = OperationalState::Active,
                (Ok(()), false) => {
                    panic!("validation bypass: resume_creation succeeded when not Paused")
                }
                (Err(err), true) => panic!("valid resume_creation rejected with {err:?}"),
                (Err(_), false) => {}
            }
        }
    }
}

/// Bounded stateful multi-asset interleaving target.
pub fn multi_asset(data: &[u8]) {
    let mut h = MultiAssetHarness::new();
    h.assert_invariants(0, true);

    let step_count = (data.len() / STEP_BYTES).clamp(1, MAX_STEPS);
    for step in 0..step_count {
        let mut bytes = [0u8; STEP_BYTES];
        let start = step * STEP_BYTES;
        if start < data.len() {
            let end = (start + STEP_BYTES).min(data.len());
            bytes[..end - start].copy_from_slice(&data[start..end]);
        }

        let is_balance_op = matches!(bytes[0] % 8, 0..=3);
        match bytes[0] % 8 {
            0 => h.step_create(&bytes),
            1 => h.step_settle(&bytes),
            2 => h.step_cancel(&bytes),
            3 => h.step_recover(&bytes),
            4 => h.step_advance_ledger(&bytes),
            5 => h.step_cap_decrease(&bytes),
            6 => h.step_cap_increase_transition(&bytes),
            _ => h.step_pause_transition(&bytes),
        }

        h.assert_invariants(step + 1, is_balance_op || step + 1 == step_count);
    }
}
