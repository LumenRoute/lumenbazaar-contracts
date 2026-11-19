extern crate std;

use crate::*;
use std::vec;
use proptest::{
    collection,
    prelude::*,
    prop_oneof,
    test_runner::{Config as ProptestConfig, RngSeed},
};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    token, Address, BytesN, Env, IntoVal,
};

const PROPERTY_CASES: u32 = 128;
const PROPERTY_SEED: u64 = 0x4c55_4d45_4e42_5a52;
const LIABILITY_SEED: u64 = 0x4c55_4d45_4c49_4142;
const REFUND_PIN_SEED: u64 = 0x4c55_4d45_5245_4650;
const EXPIRY_LEDGER: u32 = 50;

fn parse_seed_env(var: &str, default_seed: u64) -> u64 {
    std::env::var(var)
        .ok()
        .and_then(|raw| {
            let trimmed = raw.trim();
            if let Some(hex) = trimmed
                .strip_prefix("0x")
                .or_else(|| trimmed.strip_prefix("0X"))
            {
                u64::from_str_radix(hex, 16).ok()
            } else {
                trimmed.parse().ok()
            }
        })
        .unwrap_or(default_seed)
}

fn seeded_config(seed_var: &str, default_seed: u64, default_cases: u32) -> (ProptestConfig, u64) {
    let cases = std::env::var("LUMENBAZAAR_PROPERTY_CASES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default_cases);
    let seed = parse_seed_env(seed_var, default_seed);
    (
        ProptestConfig {
            cases,
            rng_seed: RngSeed::Fixed(seed),
            max_shrink_iters: 10_000,
            ..ProptestConfig::default()
        },
        seed,
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ModelStatus {
    Open,
    Settled,
    Cancelled,
    Expired,
    Rejected,
}

#[derive(Clone, Copy, Debug)]
struct ModelSession {
    cap: i128,
    settled: i128,
    status: ModelStatus,
}

fn property_config() -> ProptestConfig {
    let cases = std::env::var("LUMENBAZAAR_PROPERTY_CASES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(PROPERTY_CASES);
    ProptestConfig {
        cases,
        rng_seed: RngSeed::Fixed(PROPERTY_SEED),
        max_shrink_iters: 10_000,
        ..ProptestConfig::default()
    }
}

fn cap_strategy() -> impl Strategy<Value = (i128, i128)> {
    let cap = prop_oneof![
        Just(1_i128),
        Just(2_i128),
        Just(10_000_000_i128),
        (1_u32..1_000_000_u32).prop_map(i128::from),
    ];
    (cap.clone(), cap)
}

fn action_strategy() -> impl Strategy<Value = std::vec::Vec<(u8, u8, u8)>> {
    collection::vec((0_u8..7, 0_u8..2, 0_u8..5), 1..24)
}

fn create_asset(env: &Env, owner: &Address, amount: i128) -> Address {
    let admin = Address::generate(env);
    let asset = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::StellarAssetClient::new(env, &asset)
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &asset,
                fn_name: "mint",
                args: (owner.clone(), amount).into_val(env),
                sub_invokes: &[],
            },
        }])
        .mint(owner, &amount);
    asset
}

fn initialize(
    env: &Env,
    client: &UptoSessionContractClient<'_>,
    contract: &Address,
    admin: &Address,
    assets: &soroban_sdk::Vec<Address>,
) {
    let mut policies = soroban_sdk::Vec::new(env);
    for asset in assets.iter() {
        policies.push_back(AssetPolicy {
            asset,
            max_session_amount: i128::MAX,
            min_session_amount: 1,
            max_asset_exposure: i128::MAX,
            max_buyer_exposure: i128::MAX,
        });
    }
    client
        .mock_auths(&[MockAuth {
            address: admin,
            invoke: &MockAuthInvoke {
                contract,
                fn_name: "initialize",
                args: (admin.clone(), policies.clone()).into_val(env),
                sub_invokes: &[],
            },
        }])
        .initialize(admin, &policies);
}

struct CreateInput<'a> {
    buyer: &'a Address,
    seller: &'a Address,
    asset: &'a Address,
    cap: i128,
    resource_hash: &'a BytesN<32>,
}

fn create_session(
    env: &Env,
    client: &UptoSessionContractClient<'_>,
    contract: &Address,
    input: CreateInput<'_>,
) -> BytesN<32> {
    let idempotency_key = input.resource_hash;
    client
        .mock_auths(&[MockAuth {
            address: input.buyer,
            invoke: &MockAuthInvoke {
                contract,
                fn_name: "create_session",
                args: (
                    input.buyer.clone(),
                    input.seller.clone(),
                    input.asset.clone(),
                    input.cap,
                    EXPIRY_LEDGER,
                    input.resource_hash.clone(),
                    idempotency_key.clone(),
                )
                    .into_val(env),
                sub_invokes: &[MockAuthInvoke {
                    contract: input.asset,
                    fn_name: "transfer",
                    args: (
                        input.buyer.clone(),
                        contract.clone(),
                        input.cap,
                    )
                        .into_val(env),
                    sub_invokes: &[],
                }],
            },
        }])
        .create_session(
            input.buyer,
            input.seller,
            input.asset,
            &input.cap,
            &EXPIRY_LEDGER,
            input.resource_hash,
            idempotency_key,
        )
}

fn try_settle(
    env: &Env,
    client: &UptoSessionContractClient<'_>,
    contract: &Address,
    seller: &Address,
    session_id: &BytesN<32>,
    amount: i128,
    usage_hash: &BytesN<32>,
) -> bool {
    client
        .mock_auths(&[MockAuth {
            address: seller,
            invoke: &MockAuthInvoke {
                contract,
                fn_name: "settle",
                args: (session_id.clone(), amount, usage_hash.clone()).into_val(env),
                sub_invokes: &[],
            },
        }])
        .try_settle(session_id, &amount, usage_hash)
        .is_ok()
}

fn try_cancel(
    env: &Env,
    client: &UptoSessionContractClient<'_>,
    contract: &Address,
    buyer: &Address,
    session_id: &BytesN<32>,
) -> bool {
    client
        .mock_auths(&[MockAuth {
            address: buyer,
            invoke: &MockAuthInvoke {
                contract,
                fn_name: "cancel",
                args: (session_id.clone(),).into_val(env),
                sub_invokes: &[],
            },
        }])
        .try_cancel(session_id)
        .is_ok()
}

fn try_reject(
    env: &Env,
    client: &UptoSessionContractClient<'_>,
    contract: &Address,
    seller: &Address,
    session_id: &BytesN<32>,
) -> bool {
    client
        .mock_auths(&[MockAuth {
            address: seller,
            invoke: &MockAuthInvoke {
                contract,
                fn_name: "reject",
                args: (session_id.clone(),).into_val(env),
                sub_invokes: &[],
            },
        }])
        .try_reject(session_id)
        .is_ok()
}

fn selected_amount(selector: u8, cap: i128) -> i128 {
    match selector {
        0 => 0,
        1 => 1,
        2 => cap / 2 + cap % 2,
        3 => cap,
        _ => cap + 1,
    }
}

struct InvariantInput<'a> {
    contract: &'a Address,
    session_id: &'a BytesN<32>,
    buyer: &'a Address,
    seller: &'a Address,
    asset: &'a Address,
    model: ModelSession,
}

fn assert_session_invariants(
    env: &Env,
    client: &UptoSessionContractClient<'_>,
    input: InvariantInput<'_>,
) {
    let session = client.get_session(input.session_id);
    let token = token::Client::new(env, input.asset);
    let model = input.model;
    let (buyer_balance, seller_balance, contract_balance, escrowed, status) = match model.status {
        ModelStatus::Open => (0, 0, model.cap, model.cap, SessionStatus::Open),
        ModelStatus::Settled => (
            model.cap - model.settled,
            model.settled,
            0,
            0,
            SessionStatus::Settled,
        ),
        ModelStatus::Cancelled => (model.cap, 0, 0, 0, SessionStatus::Cancelled),
        ModelStatus::Expired => (model.cap, 0, 0, 0, SessionStatus::Expired),
        ModelStatus::Rejected => (model.cap, 0, 0, 0, SessionStatus::Rejected),
    };

    assert_eq!(session.status, status);
    assert_eq!(session.settled_amount, model.settled);
    assert_eq!(session.escrowed_amount, escrowed);
    assert!(session.settled_amount <= session.max_amount);
    assert_eq!(token.balance(input.buyer), buyer_balance);
    assert_eq!(token.balance(input.seller), seller_balance);
    assert_eq!(token.balance(input.contract), contract_balance);
    assert_eq!(buyer_balance + seller_balance + contract_balance, model.cap);
}

proptest! {
    #![proptest_config(property_config())]

    #[test]
    fn generated_sequences_preserve_value_caps_and_isolation(
        (first_cap, second_cap) in cap_strategy(),
        actions in action_strategy(),
    ) {
        let env = Env::default();
        let contract = env.register(UptoSessionContract, ());
        let client = UptoSessionContractClient::new(&env, &contract);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let buyers = [Address::generate(&env), Address::generate(&env)];
        let sellers = [Address::generate(&env), Address::generate(&env)];
        let caps = [first_cap, second_cap];
        let assets = [
            create_asset(&env, &buyers[0], caps[0]),
            create_asset(&env, &buyers[1], caps[1]),
        ];
        let supported_assets = soroban_sdk::vec![&env, assets[0].clone(), assets[1].clone()];
        initialize(&env, &client, &contract, &admin, &supported_assets);
        let resource_hashes = [
            BytesN::from_array(&env, &[61; 32]),
            BytesN::from_array(&env, &[62; 32]),
        ];
        let session_ids = [
            create_session(
                &env,
                &client,
                &contract,
                CreateInput {
                    buyer: &buyers[0],
                    seller: &sellers[0],
                    asset: &assets[0],
                    cap: caps[0],
                    resource_hash: &resource_hashes[0],
                },
            ),
            create_session(
                &env,
                &client,
                &contract,
                CreateInput {
                    buyer: &buyers[1],
                    seller: &sellers[1],
                    asset: &assets[1],
                    cap: caps[1],
                    resource_hash: &resource_hashes[1],
                },
            ),
        ];
        let mut model = [
            ModelSession { cap: caps[0], settled: 0, status: ModelStatus::Open },
            ModelSession { cap: caps[1], settled: 0, status: ModelStatus::Open },
        ];
        let mut expired = false;

        for (step, (kind, raw_index, amount_selector)) in actions.into_iter().enumerate() {
            let index = usize::from(raw_index);
            let before = model[index];
            let usage_byte = u8::try_from(step % 190 + 63).expect("bounded usage byte");
            let usage_hash = BytesN::from_array(&env, &[usage_byte; 32]);

            match kind {
                0 => {
                    let amount = selected_amount(amount_selector, caps[index]);
                    let succeeded = try_settle(
                        &env,
                        &client,
                        &contract,
                        &sellers[index],
                        &session_ids[index],
                        amount,
                        &usage_hash,
                    );
                    let expected = before.status == ModelStatus::Open
                        && !expired
                        && amount > 0
                        && amount <= caps[index];
                    prop_assert_eq!(succeeded, expected);
                    if expected {
                        model[index].status = ModelStatus::Settled;
                        model[index].settled = amount;
                    }
                }
                1 => {
                    let succeeded = try_cancel(
                        &env,
                        &client,
                        &contract,
                        &buyers[index],
                        &session_ids[index],
                    );
                    let expected = before.status == ModelStatus::Open && !expired;
                    prop_assert_eq!(succeeded, expected);
                    if expected {
                        model[index].status = ModelStatus::Cancelled;
                    }
                }
                2 => {
                    env.ledger().set_sequence_number(EXPIRY_LEDGER);
                    expired = true;
                }
                3 => {
                    let succeeded = client.try_recover_expired(&session_ids[index]).is_ok();
                    let expected = before.status == ModelStatus::Open && expired;
                    prop_assert_eq!(succeeded, expected);
                    if expected {
                        model[index].status = ModelStatus::Expired;
                    }
                }
                4 => {
                    let first = try_settle(
                        &env,
                        &client,
                        &contract,
                        &sellers[index],
                        &session_ids[index],
                        1,
                        &usage_hash,
                    );
                    let expected = before.status == ModelStatus::Open && !expired;
                    prop_assert_eq!(first, expected);
                    if expected {
                        model[index].status = ModelStatus::Settled;
                        model[index].settled = 1;
                    }
                    prop_assert!(!try_settle(
                        &env,
                        &client,
                        &contract,
                        &sellers[index],
                        &session_ids[index],
                        1,
                        &usage_hash,
                    ));
                }
                5 => {
                    let succeeded = try_reject(
                        &env,
                        &client,
                        &contract,
                        &sellers[index],
                        &session_ids[index],
                    );
                    let expected = before.status == ModelStatus::Open && !expired;
                    prop_assert_eq!(succeeded, expected);
                    if expected {
                        model[index].status = ModelStatus::Rejected;
                    }
                }
                _ => {
                    prop_assert!(!try_settle(
                        &env,
                        &client,
                        &contract,
                        &attacker,
                        &session_ids[index],
                        1,
                        &usage_hash,
                    ));
                }
            }

            for check_index in 0..2 {
                assert_session_invariants(
                    &env,
                    &client,
                    InvariantInput {
                        contract: &contract,
                        session_id: &session_ids[check_index],
                        buyer: &buyers[check_index],
                        seller: &sellers[check_index],
                        asset: &assets[check_index],
                        model: model[check_index],
                    },
                );
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum MixedHistoryOp {
    Create {
        buyer: u8,
        seller: u8,
        asset: u8,
        cap: i128,
        duration: u32,
    },
    Settle {
        slot: u8,
        amount_sel: u8,
    },
    Cancel {
        slot: u8,
    },
    Reject {
        slot: u8,
    },
    ReduceCap {
        slot: u8,
        new_cap_sel: u8,
    },
    ExtendExpiry {
        slot: u8,
        delta: u32,
    },
    ExtendTtl {
        slot: u8,
    },
    AdvanceLedger {
        delta: u32,
    },
    RecoverExpired {
        slot: u8,
    },
    RecoverBatch {
        slot_a: u8,
        slot_b: u8,
    },
}

fn mixed_history_op_strategy() -> impl Strategy<Value = MixedHistoryOp> {
    let cap = prop_oneof![
        Just(1_i128),
        Just(2_i128),
        Just(100_i128),
        (1_u32..50_000_u32).prop_map(i128::from),
    ];
    prop_oneof![
        4 => (0_u8..3, 0_u8..3, 0_u8..2, cap, 5_u32..40_u32).prop_map(
            |(buyer, seller, asset, cap, duration)| MixedHistoryOp::Create {
                buyer,
                seller,
                asset,
                cap,
                duration,
            },
        ),
        3 => (0_u8..8, 0_u8..5).prop_map(|(slot, amount_sel)| MixedHistoryOp::Settle {
            slot,
            amount_sel,
        }),
        2 => (0_u8..8).prop_map(|slot| MixedHistoryOp::Cancel { slot }),
        2 => (0_u8..8).prop_map(|slot| MixedHistoryOp::Reject { slot }),
        2 => (0_u8..8, 0_u8..4).prop_map(|(slot, new_cap_sel)| MixedHistoryOp::ReduceCap {
            slot,
            new_cap_sel,
        }),
        1 => (0_u8..8, 1_u32..15_u32).prop_map(|(slot, delta)| MixedHistoryOp::ExtendExpiry {
            slot,
            delta,
        }),
        1 => (0_u8..8).prop_map(|slot| MixedHistoryOp::ExtendTtl { slot }),
        2 => (1_u32..25_u32).prop_map(|delta| MixedHistoryOp::AdvanceLedger { delta }),
        2 => (0_u8..8).prop_map(|slot| MixedHistoryOp::RecoverExpired { slot }),
        2 => (0_u8..8, 0_u8..8).prop_map(|(slot_a, slot_b)| MixedHistoryOp::RecoverBatch {
            slot_a,
            slot_b,
        }),
    ]
}

#[derive(Clone)]
struct TrackedSession {
    id: BytesN<32>,
    buyer_idx: usize,
    seller_idx: usize,
    asset_idx: usize,
    cap: i128,
    escrowed: i128,
    settled: i128,
    expires_at: u32,
    status: ModelStatus,
}

fn mint_for_many(env: &Env, accounts: &[Address], amount_each: i128) -> Address {
    let admin = Address::generate(env);
    let asset = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let mint = token::StellarAssetClient::new(env, &asset);
    for account in accounts {
        mint.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &asset,
                fn_name: "mint",
                args: (account.clone(), amount_each).into_val(env),
                sub_invokes: &[],
            },
        }])
        .mint(account, &amount_each);
    }
    asset
}

fn make_key(env: &Env, tag: u8, step: usize) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0] = tag;
    bytes[1..9].copy_from_slice(&(step as u64).to_be_bytes());
    bytes[31] = 1;
    BytesN::from_array(env, &bytes)
}

#[test]
fn generated_mixed_histories_conserve_escrow_liabilities_across_transitions() {
    let (config, seed) = seeded_config("LUMENBAZAAR_LIABILITY_SEED", LIABILITY_SEED, 64);
    let mut runner = proptest::test_runner::TestRunner::new(config);
    let strategy = collection::vec(mixed_history_op_strategy(), 1..20);

    runner
        .run(&strategy, |ops| {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();
            let contract = env.register(UptoSessionContract, ());
            let client = UptoSessionContractClient::new(&env, &contract);
            let admin = Address::generate(&env);
            let buyers = [
                Address::generate(&env),
                Address::generate(&env),
                Address::generate(&env),
            ];
            let sellers = [
                Address::generate(&env),
                Address::generate(&env),
                Address::generate(&env),
            ];
            const INITIAL_MINT: i128 = 10_000_000;
            let assets = [
                mint_for_many(&env, &buyers, INITIAL_MINT),
                mint_for_many(&env, &buyers, INITIAL_MINT),
            ];
            let supported = soroban_sdk::vec![&env, assets[0].clone(), assets[1].clone()];
            initialize(&env, &client, &contract, &admin, &supported);

            let mut sessions: std::vec::Vec<TrackedSession> = std::vec::Vec::new();
            let mut buyer_balances = [[INITIAL_MINT; 2]; 3];
            let mut seller_balances = [[0_i128; 2]; 3];
            let mut total_deposited = [0_i128; 2];
            let mut total_settled = [0_i128; 2];
            let mut total_refunded = [0_i128; 2];
            let mut current_ledger: u32 = 0;

            for (step, op) in ops.iter().copied().enumerate() {
                match op {
                    MixedHistoryOp::Create {
                        buyer,
                        seller,
                        asset,
                        cap,
                        duration,
                    } => {
                        let b = usize::from(buyer);
                        let s = usize::from(seller);
                        let a = usize::from(asset);
                        let expires_at = current_ledger.saturating_add(duration);
                        let rhash = make_key(&env, 0x11, step + 1);
                        let ikey = make_key(&env, 0x22, step + 1);
                        let result = client.try_create_session(
                            &buyers[b],
                            &sellers[s],
                            &assets[a],
                            &cap,
                            &expires_at,
                            &rhash,
                            &ikey,
                        );
                        if let Ok(Ok(id)) = result {
                            buyer_balances[b][a] -= cap;
                            total_deposited[a] += cap;
                            sessions.push(TrackedSession {
                                id,
                                buyer_idx: b,
                                seller_idx: s,
                                asset_idx: a,
                                cap,
                                escrowed: cap,
                                settled: 0,
                                expires_at,
                                status: ModelStatus::Open,
                            });
                        }
                    }
                    MixedHistoryOp::Settle { slot, amount_sel } => {
                        if let Some(idx) = (!sessions.is_empty()).then(|| usize::from(slot) % sessions.len()) {
                            let amount = selected_amount(amount_sel, sessions[idx].cap);
                            let usage = make_key(&env, 0x33, step + 1);
                            let res = client.try_settle(&sessions[idx].id, &amount, &usage);
                            let expected = sessions[idx].status == ModelStatus::Open
                                && current_ledger < sessions[idx].expires_at
                                && amount > 0
                                && amount <= sessions[idx].cap;
                            prop_assert_eq!(
                                res.is_ok(),
                                expected,
                                "replay seed LUMENBAZAAR_LIABILITY_SEED=0x{:016x} step={} op={:?}",
                                seed,
                                step,
                                op
                            );
                            if expected {
                                let a = sessions[idx].asset_idx;
                                let b = sessions[idx].buyer_idx;
                                let s = sessions[idx].seller_idx;
                                let refund = sessions[idx].escrowed - amount;
                                seller_balances[s][a] += amount;
                                buyer_balances[b][a] += refund;
                                total_settled[a] += amount;
                                total_refunded[a] += refund;
                                sessions[idx].escrowed = 0;
                                sessions[idx].settled = amount;
                                sessions[idx].status = ModelStatus::Settled;
                            }
                        }
                    }
                    MixedHistoryOp::Cancel { slot } => {
                        if let Some(idx) = (!sessions.is_empty()).then(|| usize::from(slot) % sessions.len()) {
                            let res = client.try_cancel(&sessions[idx].id);
                            let expected = sessions[idx].status == ModelStatus::Open
                                && current_ledger < sessions[idx].expires_at;
                            prop_assert_eq!(
                                res.is_ok(),
                                expected,
                                "replay seed LUMENBAZAAR_LIABILITY_SEED=0x{:016x} step={} op={:?}",
                                seed,
                                step,
                                op
                            );
                            if expected {
                                let a = sessions[idx].asset_idx;
                                let b = sessions[idx].buyer_idx;
                                let refund = sessions[idx].escrowed;
                                buyer_balances[b][a] += refund;
                                total_refunded[a] += refund;
                                sessions[idx].escrowed = 0;
                                sessions[idx].status = ModelStatus::Cancelled;
                            }
                        }
                    }
                    MixedHistoryOp::Reject { slot } => {
                        if let Some(idx) = (!sessions.is_empty()).then(|| usize::from(slot) % sessions.len()) {
                            let res = client.try_reject(&sessions[idx].id);
                            let expected = sessions[idx].status == ModelStatus::Open
                                && current_ledger < sessions[idx].expires_at;
                            prop_assert_eq!(
                                res.is_ok(),
                                expected,
                                "replay seed LUMENBAZAAR_LIABILITY_SEED=0x{:016x} step={} op={:?}",
                                seed,
                                step,
                                op
                            );
                            if expected {
                                let a = sessions[idx].asset_idx;
                                let b = sessions[idx].buyer_idx;
                                let refund = sessions[idx].escrowed;
                                buyer_balances[b][a] += refund;
                                total_refunded[a] += refund;
                                sessions[idx].escrowed = 0;
                                sessions[idx].status = ModelStatus::Rejected;
                            }
                        }
                    }
                    MixedHistoryOp::ReduceCap { slot, new_cap_sel } => {
                        if let Some(idx) = (!sessions.is_empty()).then(|| usize::from(slot) % sessions.len()) {
                            let cur = sessions[idx].cap;
                            let new_cap = match new_cap_sel {
                                0 => 0,
                                1 => (cur / 2).max(1),
                                2 => cur - 1,
                                _ => cur,
                            };
                            let res = client.try_reduce_session_cap(&sessions[idx].id, &new_cap);
                            let expected = sessions[idx].status == ModelStatus::Open
                                && current_ledger < sessions[idx].expires_at
                                && new_cap > 0
                                && new_cap < cur;
                            prop_assert_eq!(
                                res.is_ok(),
                                expected,
                                "replay seed LUMENBAZAAR_LIABILITY_SEED=0x{:016x} step={} op={:?}",
                                seed,
                                step,
                                op
                            );
                            if expected {
                                let a = sessions[idx].asset_idx;
                                let b = sessions[idx].buyer_idx;
                                let diff = cur - new_cap;
                                buyer_balances[b][a] += diff;
                                total_refunded[a] += diff;
                                sessions[idx].cap = new_cap;
                                sessions[idx].escrowed = new_cap;
                            }
                        }
                    }
                    MixedHistoryOp::ExtendExpiry { slot, delta } => {
                        if let Some(idx) = (!sessions.is_empty()).then(|| usize::from(slot) % sessions.len()) {
                            let new_expiry = sessions[idx].expires_at.saturating_add(delta);
                            let res =
                                client.try_extend_session_expiry(&sessions[idx].id, &new_expiry);
                            if res.is_ok() {
                                sessions[idx].expires_at = new_expiry;
                            }
                        }
                    }
                    MixedHistoryOp::ExtendTtl { slot } => {
                        if let Some(idx) = (!sessions.is_empty()).then(|| usize::from(slot) % sessions.len()) {
                            let _ = client.try_extend_ttl(&sessions[idx].id);
                        }
                    }
                    MixedHistoryOp::AdvanceLedger { delta } => {
                        current_ledger = current_ledger.saturating_add(delta);
                        env.ledger().set_sequence_number(current_ledger);
                    }
                    MixedHistoryOp::RecoverExpired { slot } => {
                        if let Some(idx) = (!sessions.is_empty()).then(|| usize::from(slot) % sessions.len()) {
                            let res = client.try_recover_expired(&sessions[idx].id);
                            let expected = sessions[idx].status == ModelStatus::Open
                                && current_ledger >= sessions[idx].expires_at;
                            prop_assert_eq!(
                                res.is_ok(),
                                expected,
                                "replay seed LUMENBAZAAR_LIABILITY_SEED=0x{:016x} step={} op={:?}",
                                seed,
                                step,
                                op
                            );
                            if expected {
                                let a = sessions[idx].asset_idx;
                                let b = sessions[idx].buyer_idx;
                                let refund = sessions[idx].escrowed;
                                buyer_balances[b][a] += refund;
                                total_refunded[a] += refund;
                                sessions[idx].escrowed = 0;
                                sessions[idx].status = ModelStatus::Expired;
                            }
                        }
                    }
                    MixedHistoryOp::RecoverBatch { slot_a, slot_b } => {
                        if !sessions.is_empty() {
                            let idx_a = usize::from(slot_a) % sessions.len();
                            let idx_b = usize::from(slot_b) % sessions.len();
                            let batch = soroban_sdk::vec![
                                &env,
                                sessions[idx_a].id.clone(),
                                sessions[idx_b].id.clone()
                            ];
                            let results = client.recover_expired_batch(&batch);
                            for (pos, idx) in [idx_a, idx_b].into_iter().enumerate() {
                                if results.get(pos as u32).unwrap().status
                                    == BatchRecoveryStatus::Recovered
                                {
                                    let a = sessions[idx].asset_idx;
                                    let b = sessions[idx].buyer_idx;
                                    let refund = sessions[idx].escrowed;
                                    buyer_balances[b][a] += refund;
                                    total_refunded[a] += refund;
                                    sessions[idx].escrowed = 0;
                                    sessions[idx].status = ModelStatus::Expired;
                                }
                            }
                        }
                    }
                }

                // Conservation check after EVERY generated operation across all buyers, sellers, and assets.
                for (a, asset) in assets.iter().enumerate() {
                    let tok = token::Client::new(&env, asset);
                    let contract_bal = tok.balance(&contract);
                    let onchain_liability = client.get_escrow_liability(asset);
                    let expected_open_liability: i128 = sessions
                        .iter()
                        .filter(|s| s.asset_idx == a && s.status == ModelStatus::Open)
                        .map(|s| s.escrowed)
                        .sum();

                    prop_assert_eq!(
                        onchain_liability,
                        expected_open_liability,
                        "liability drift; replay seed LUMENBAZAAR_LIABILITY_SEED=0x{:016x} step={} asset={}",
                        seed,
                        step,
                        a
                    );
                    prop_assert_eq!(
                        contract_bal,
                        expected_open_liability,
                        "escrow balance != liability; replay seed LUMENBAZAAR_LIABILITY_SEED=0x{:016x} step={} asset={}",
                        seed,
                        step,
                        a
                    );
                    prop_assert_eq!(
                        contract_bal + total_settled[a] + total_refunded[a],
                        total_deposited[a],
                        "escrow value not conserved; replay seed LUMENBAZAAR_LIABILITY_SEED=0x{:016x} step={} asset={}",
                        seed,
                        step,
                        a
                    );

                    let mut total_held = contract_bal;
                    for (b, buyer) in buyers.iter().enumerate() {
                        let bal = tok.balance(buyer);
                        prop_assert_eq!(
                            bal,
                            buyer_balances[b][a],
                            "buyer balance mismatch; replay seed LUMENBAZAAR_LIABILITY_SEED=0x{:016x} step={} buyer={} asset={}",
                            seed,
                            step,
                            b,
                            a
                        );
                        let expected_exposure: i128 = sessions
                            .iter()
                            .filter(|s| {
                                s.asset_idx == a
                                    && s.buyer_idx == b
                                    && s.status == ModelStatus::Open
                            })
                            .map(|s| s.escrowed)
                            .sum();
                        prop_assert_eq!(
                            client.get_buyer_exposure(buyer, asset),
                            expected_exposure,
                            "buyer exposure mismatch; replay seed LUMENBAZAAR_LIABILITY_SEED=0x{:016x} step={} buyer={} asset={}",
                            seed,
                            step,
                            b,
                            a
                        );
                        total_held += bal;
                    }
                    for (s, seller) in sellers.iter().enumerate() {
                        let bal = tok.balance(seller);
                        prop_assert_eq!(
                            bal,
                            seller_balances[s][a],
                            "seller balance mismatch; replay seed LUMENBAZAAR_LIABILITY_SEED=0x{:016x} step={} seller={} asset={}",
                            seed,
                            step,
                            s,
                            a
                        );
                        total_held += bal;
                    }
                    prop_assert_eq!(
                        total_held,
                        INITIAL_MINT * (buyers.len() as i128),
                        "total token supply drift; replay seed LUMENBAZAAR_LIABILITY_SEED=0x{:016x} step={} asset={}",
                        seed,
                        step,
                        a
                    );
                }
            }
            Ok(())
        })
        .unwrap_or_else(|err| {
            panic!(
                "escrow liability conservation failed (replay with LUMENBAZAAR_LIABILITY_SEED=0x{:016x}): {err}",
                seed
            );
        });
}

#[derive(Clone, Copy, Debug)]
enum RefundPinOp {
    BuyerCancel { slot: u8 },
    AdversarialCancel { slot: u8, caller: u8 },
    SellerReject { slot: u8 },
    AdversarialReject { slot: u8, caller: u8 },
    BuyerReduceCap { slot: u8 },
    AdversarialReduceCap { slot: u8, caller: u8 },
    PartialSettle { slot: u8, amount_sel: u8 },
    AdvanceToExpiry,
    PermissionlessRecover { slot: u8, caller: u8 },
    BatchRecover { slot_a: u8, slot_b: u8 },
    RotateAdmin,
    DeprecateAsset { asset: u8 },
    PauseOrResume,
}

fn refund_pin_op_strategy() -> impl Strategy<Value = RefundPinOp> {
    prop_oneof![
        3 => (0_u8..4).prop_map(|slot| RefundPinOp::BuyerCancel { slot }),
        3 => (0_u8..4, 0_u8..4).prop_map(|(slot, caller)| RefundPinOp::AdversarialCancel { slot, caller }),
        3 => (0_u8..4).prop_map(|slot| RefundPinOp::SellerReject { slot }),
        3 => (0_u8..4, 0_u8..4).prop_map(|(slot, caller)| RefundPinOp::AdversarialReject { slot, caller }),
        2 => (0_u8..4).prop_map(|slot| RefundPinOp::BuyerReduceCap { slot }),
        2 => (0_u8..4, 0_u8..4).prop_map(|(slot, caller)| RefundPinOp::AdversarialReduceCap { slot, caller }),
        3 => (0_u8..4, 1_u8..4).prop_map(|(slot, amount_sel)| RefundPinOp::PartialSettle { slot, amount_sel }),
        2 => Just(RefundPinOp::AdvanceToExpiry),
        3 => (0_u8..4, 0_u8..4).prop_map(|(slot, caller)| RefundPinOp::PermissionlessRecover { slot, caller }),
        2 => (0_u8..4, 0_u8..4).prop_map(|(slot_a, slot_b)| RefundPinOp::BatchRecover { slot_a, slot_b }),
        1 => Just(RefundPinOp::RotateAdmin),
        1 => (0_u8..2).prop_map(|asset| RefundPinOp::DeprecateAsset { asset }),
        1 => Just(RefundPinOp::PauseOrResume),
    ]
}

#[test]
fn refund_destination_is_pinned_to_original_buyer_across_all_refund_paths() {
    let (config, seed) = seeded_config("LUMENBAZAAR_REFUND_SEED", REFUND_PIN_SEED, 64);
    let mut runner = proptest::test_runner::TestRunner::new(config);
    let strategy = (
        cap_strategy(),
        cap_strategy(),
        collection::vec(refund_pin_op_strategy(), 1..20),
    );

    runner
        .run(&strategy, |((c0, c1), (c2, c3), ops)| {
            let env = Env::default();
            let contract = env.register(UptoSessionContract, ());
            let client = UptoSessionContractClient::new(&env, &contract);
            let admin = Address::generate(&env);
            let next_admin = Address::generate(&env);
            let attacker = Address::generate(&env);
            let buyers = [Address::generate(&env), Address::generate(&env)];
            let sellers = [Address::generate(&env), Address::generate(&env)];

            let caps = [c0.max(2), c1.max(2), c2.max(2), c3.max(2)];
            let mint_a0 = caps[0] + caps[2];
            let mint_a1 = caps[1] + caps[3];
            let assets = [
                mint_for_many(&env, &buyers, mint_a0),
                mint_for_many(&env, &buyers, mint_a1),
            ];
            let supported = soroban_sdk::vec![&env, assets[0].clone(), assets[1].clone()];
            initialize(&env, &client, &contract, &admin, &supported);

            // 4 sessions spanning both buyers, both sellers, and both assets.
            let specs = [
                (0usize, 0usize, 0usize, caps[0]),
                (1usize, 1usize, 1usize, caps[1]),
                (0usize, 1usize, 0usize, caps[2]),
                (1usize, 0usize, 1usize, caps[3]),
            ];
            let mut sessions: std::vec::Vec<TrackedSession> = std::vec::Vec::new();
            for (idx, (b, s, a, cap)) in specs.into_iter().enumerate() {
                let rhash = make_key(&env, 0x41, idx + 1);
                let id = create_session(
                    &env,
                    &client,
                    &contract,
                    CreateInput {
                        buyer: &buyers[b],
                        seller: &sellers[s],
                        asset: &assets[a],
                        cap,
                        resource_hash: &rhash,
                    },
                );
                sessions.push(TrackedSession {
                    id,
                    buyer_idx: b,
                    seller_idx: s,
                    asset_idx: a,
                    cap,
                    escrowed: cap,
                    settled: 0,
                    expires_at: EXPIRY_LEDGER,
                    status: ModelStatus::Open,
                });
            }

            let mut active_admin = admin.clone();
            let mut expired = false;
            let mut paused = false;

            let snapshot_all = |env: &Env| -> [[i128; 2]; 8] {
                let addrs = [
                    &buyers[0],
                    &buyers[1],
                    &sellers[0],
                    &sellers[1],
                    &admin,
                    &next_admin,
                    &attacker,
                    &contract,
                ];
                let mut out = [[0_i128; 2]; 8];
                for (a, asset) in assets.iter().enumerate() {
                    let tok = token::Client::new(env, asset);
                    for (i, addr) in addrs.iter().enumerate() {
                        out[i][a] = tok.balance(addr);
                    }
                }
                out
            };

            for (step, op) in ops.into_iter().enumerate() {
                let before = snapshot_all(&env);
                let usage_hash = make_key(&env, 0x55, step + 1);
                let mut allowed_seller_credit: Option<(usize, usize, i128)> = None;
                let mut expected_buyer_credits = [[0_i128; 2]; 2];

                match op {
                    RefundPinOp::BuyerCancel { slot } => {
                        let idx = usize::from(slot);
                        let b = sessions[idx].buyer_idx;
                        let a = sessions[idx].asset_idx;
                        let ok = try_cancel(&env, &client, &contract, &buyers[b], &sessions[idx].id);
                        let expected = sessions[idx].status == ModelStatus::Open && !expired;
                        prop_assert_eq!(ok, expected);
                        if expected {
                            expected_buyer_credits[b][a] += sessions[idx].escrowed;
                            sessions[idx].escrowed = 0;
                            sessions[idx].status = ModelStatus::Cancelled;
                        }
                    }
                    RefundPinOp::AdversarialCancel { slot, caller } => {
                        let idx = usize::from(slot);
                        let b = sessions[idx].buyer_idx;
                        let s = sessions[idx].seller_idx;
                        let adversarial = match caller {
                            0 => &sellers[s],
                            1 => &active_admin,
                            2 => &attacker,
                            _ => &buyers[1 - b],
                        };
                        let ok = try_cancel(&env, &client, &contract, adversarial, &sessions[idx].id);
                        prop_assert!(
                            !ok,
                            "adversarial cancel succeeded; replay LUMENBAZAAR_REFUND_SEED=0x{:016x}",
                            seed
                        );
                    }
                    RefundPinOp::SellerReject { slot } => {
                        let idx = usize::from(slot);
                        let b = sessions[idx].buyer_idx;
                        let s = sessions[idx].seller_idx;
                        let a = sessions[idx].asset_idx;
                        let ok = try_reject(&env, &client, &contract, &sellers[s], &sessions[idx].id);
                        let expected = sessions[idx].status == ModelStatus::Open && !expired;
                        prop_assert_eq!(ok, expected);
                        if expected {
                            expected_buyer_credits[b][a] += sessions[idx].escrowed;
                            sessions[idx].escrowed = 0;
                            sessions[idx].status = ModelStatus::Rejected;
                        }
                    }
                    RefundPinOp::AdversarialReject { slot, caller } => {
                        let idx = usize::from(slot);
                        let b = sessions[idx].buyer_idx;
                        let s = sessions[idx].seller_idx;
                        let adversarial = match caller {
                            0 => &buyers[b],
                            1 => &active_admin,
                            2 => &attacker,
                            _ => &sellers[1 - s],
                        };
                        let ok = try_reject(&env, &client, &contract, adversarial, &sessions[idx].id);
                        prop_assert!(
                            !ok,
                            "adversarial reject succeeded; replay LUMENBAZAAR_REFUND_SEED=0x{:016x}",
                            seed
                        );
                    }
                    RefundPinOp::BuyerReduceCap { slot } => {
                        let idx = usize::from(slot);
                        let b = sessions[idx].buyer_idx;
                        let a = sessions[idx].asset_idx;
                        let cur = sessions[idx].cap;
                        if cur > 1 {
                            let new_cap = cur / 2;
                            let ok = client
                                .mock_auths(&[MockAuth {
                                    address: &buyers[b],
                                    invoke: &MockAuthInvoke {
                                        contract: &contract,
                                        fn_name: "reduce_session_cap",
                                        args: (sessions[idx].id.clone(), new_cap).into_val(&env),
                                        sub_invokes: &[],
                                    },
                                }])
                                .try_reduce_session_cap(&sessions[idx].id, &new_cap)
                                .is_ok();
                            let expected = sessions[idx].status == ModelStatus::Open && !expired;
                            prop_assert_eq!(ok, expected);
                            if expected {
                                let diff = cur - new_cap;
                                expected_buyer_credits[b][a] += diff;
                                sessions[idx].cap = new_cap;
                                sessions[idx].escrowed = new_cap;
                            }
                        }
                    }
                    RefundPinOp::AdversarialReduceCap { slot, caller } => {
                        let idx = usize::from(slot);
                        let b = sessions[idx].buyer_idx;
                        let s = sessions[idx].seller_idx;
                        let cur = sessions[idx].cap;
                        if cur > 1 {
                            let new_cap = cur / 2;
                            let adversarial = match caller {
                                0 => &sellers[s],
                                1 => &active_admin,
                                2 => &attacker,
                                _ => &buyers[1 - b],
                            };
                            let ok = client
                                .mock_auths(&[MockAuth {
                                    address: adversarial,
                                    invoke: &MockAuthInvoke {
                                        contract: &contract,
                                        fn_name: "reduce_session_cap",
                                        args: (sessions[idx].id.clone(), new_cap).into_val(&env),
                                        sub_invokes: &[],
                                    },
                                }])
                                .try_reduce_session_cap(&sessions[idx].id, &new_cap)
                                .is_ok();
                            prop_assert!(
                                !ok,
                                "adversarial reduce_session_cap succeeded; replay LUMENBAZAAR_REFUND_SEED=0x{:016x}",
                                seed
                            );
                        }
                    }
                    RefundPinOp::PartialSettle { slot, amount_sel } => {
                        let idx = usize::from(slot);
                        let b = sessions[idx].buyer_idx;
                        let s = sessions[idx].seller_idx;
                        let a = sessions[idx].asset_idx;
                        let amount = selected_amount(amount_sel, sessions[idx].cap);
                        let ok = try_settle(
                            &env,
                            &client,
                            &contract,
                            &sellers[s],
                            &sessions[idx].id,
                            amount,
                            &usage_hash,
                        );
                        let expected = sessions[idx].status == ModelStatus::Open
                            && !expired
                            && amount > 0
                            && amount <= sessions[idx].cap;
                        prop_assert_eq!(ok, expected);
                        if expected {
                            let refund = sessions[idx].escrowed - amount;
                            allowed_seller_credit = Some((s, a, amount));
                            expected_buyer_credits[b][a] += refund;
                            sessions[idx].escrowed = 0;
                            sessions[idx].settled = amount;
                            sessions[idx].status = ModelStatus::Settled;
                        }
                    }
                    RefundPinOp::AdvanceToExpiry => {
                        env.ledger().set_sequence_number(EXPIRY_LEDGER);
                        expired = true;
                    }
                    RefundPinOp::PermissionlessRecover { slot, caller } => {
                        let idx = usize::from(slot);
                        let b = sessions[idx].buyer_idx;
                        let s = sessions[idx].seller_idx;
                        let a = sessions[idx].asset_idx;
                        // Even when invoked with seller/admin/attacker auth attached, recovery
                        // always refunds strictly to the stored original buyer.
                        let ok = match caller {
                            0 => client
                                .mock_auths(&[MockAuth {
                                    address: &sellers[s],
                                    invoke: &MockAuthInvoke {
                                        contract: &contract,
                                        fn_name: "recover_expired",
                                        args: (sessions[idx].id.clone(),).into_val(&env),
                                        sub_invokes: &[],
                                    },
                                }])
                                .try_recover_expired(&sessions[idx].id)
                                .is_ok(),
                            1 => client
                                .mock_auths(&[MockAuth {
                                    address: &active_admin,
                                    invoke: &MockAuthInvoke {
                                        contract: &contract,
                                        fn_name: "recover_expired",
                                        args: (sessions[idx].id.clone(),).into_val(&env),
                                        sub_invokes: &[],
                                    },
                                }])
                                .try_recover_expired(&sessions[idx].id)
                                .is_ok(),
                            2 => client
                                .mock_auths(&[MockAuth {
                                    address: &attacker,
                                    invoke: &MockAuthInvoke {
                                        contract: &contract,
                                        fn_name: "recover_expired",
                                        args: (sessions[idx].id.clone(),).into_val(&env),
                                        sub_invokes: &[],
                                    },
                                }])
                                .try_recover_expired(&sessions[idx].id)
                                .is_ok(),
                            _ => client.try_recover_expired(&sessions[idx].id).is_ok(),
                        };
                        let expected = sessions[idx].status == ModelStatus::Open && expired;
                        prop_assert_eq!(ok, expected);
                        if expected {
                            expected_buyer_credits[b][a] += sessions[idx].escrowed;
                            sessions[idx].escrowed = 0;
                            sessions[idx].status = ModelStatus::Expired;
                        }
                    }
                    RefundPinOp::BatchRecover { slot_a, slot_b } => {
                        let ia = usize::from(slot_a);
                        let ib = usize::from(slot_b);
                        let batch = soroban_sdk::vec![
                            &env,
                            sessions[ia].id.clone(),
                            sessions[ib].id.clone()
                        ];
                        let results = client.recover_expired_batch(&batch);
                        for (pos, idx) in [ia, ib].into_iter().enumerate() {
                            if results.get(pos as u32).unwrap().status
                                == BatchRecoveryStatus::Recovered
                            {
                                let b = sessions[idx].buyer_idx;
                                let a = sessions[idx].asset_idx;
                                expected_buyer_credits[b][a] += sessions[idx].escrowed;
                                sessions[idx].escrowed = 0;
                                sessions[idx].status = ModelStatus::Expired;
                            }
                        }
                    }
                    RefundPinOp::RotateAdmin => {
                        if active_admin == admin {
                            let rot_expiry = env.ledger().sequence() + 20;
                            let _ = client
                                .mock_auths(&[MockAuth {
                                    address: &admin,
                                    invoke: &MockAuthInvoke {
                                        contract: &contract,
                                        fn_name: "propose_admin",
                                        args: (next_admin.clone(), rot_expiry).into_val(&env),
                                        sub_invokes: &[],
                                    },
                                }])
                                .try_propose_admin(&next_admin, &rot_expiry);
                            if client
                                .mock_auths(&[MockAuth {
                                    address: &next_admin,
                                    invoke: &MockAuthInvoke {
                                        contract: &contract,
                                        fn_name: "accept_admin",
                                        args: ().into_val(&env),
                                        sub_invokes: &[],
                                    },
                                }])
                                .try_accept_admin()
                                .is_ok()
                            {
                                active_admin = next_admin.clone();
                            }
                        }
                    }
                    RefundPinOp::DeprecateAsset { asset } => {
                        let a = usize::from(asset);
                        let reason = make_key(&env, 0x66, step + 1);
                        let _ = client
                            .mock_auths(&[MockAuth {
                                address: &active_admin,
                                invoke: &MockAuthInvoke {
                                    contract: &contract,
                                    fn_name: "deprecate_asset",
                                    args: (assets[a].clone(), reason.clone()).into_val(&env),
                                    sub_invokes: &[],
                                },
                            }])
                            .try_deprecate_asset(&assets[a], &reason);
                    }
                    RefundPinOp::PauseOrResume => {
                        let fn_name = if paused {
                            "resume_creation"
                        } else {
                            "pause_creation"
                        };
                        let auth = [MockAuth {
                            address: &active_admin,
                            invoke: &MockAuthInvoke {
                                contract: &contract,
                                fn_name,
                                args: ().into_val(&env),
                                sub_invokes: &[],
                            },
                        }];
                        let ok = if paused {
                            client.mock_auths(&auth).try_resume_creation().is_ok()
                        } else {
                            client.mock_auths(&auth).try_pause_creation().is_ok()
                        };
                        if ok {
                            paused = !paused;
                        }
                    }
                }

                // Refund destination pinning + conservation checks after EVERY step:
                let after = snapshot_all(&env);
                for (a, asset) in assets.iter().enumerate() {
                    // Buyers receive ONLY their exact expected refunds.
                    for b in 0..2 {
                        prop_assert_eq!(
                            after[b][a] - before[b][a],
                            expected_buyer_credits[b][a],
                            "buyer refund delta mismatch; replay LUMENBAZAAR_REFUND_SEED=0x{:016x} step={}",
                            seed,
                            step
                        );
                    }
                    // Sellers receive ONLY an explicitly expected settlement payout, NEVER a refund.
                    for s in 0..2 {
                        let expected_seller = match allowed_seller_credit {
                            Some((cs, ca, amt)) if cs == s && ca == a => amt,
                            _ => 0,
                        };
                        prop_assert_eq!(
                            after[2 + s][a] - before[2 + s][a],
                            expected_seller,
                            "seller received unexpected funds; replay LUMENBAZAAR_REFUND_SEED=0x{:016x} step={}",
                            seed,
                            step
                        );
                    }
                    // Admin, rotated admin, and attacker NEVER receive a single stroop.
                    for non_party in 4..7 {
                        prop_assert_eq!(
                            after[non_party][a],
                            before[non_party][a],
                            "non-buyer party received diverted funds; replay LUMENBAZAAR_REFUND_SEED=0x{:016x} step={}",
                            seed,
                            step
                        );
                    }
                    // Escrow balance and recorded liability remain strictly conserved (including for deprecated assets).
                    let expected_open: i128 = sessions
                        .iter()
                        .filter(|s| s.asset_idx == a && s.status == ModelStatus::Open)
                        .map(|s| s.escrowed)
                        .sum();
                    prop_assert_eq!(after[7][a], expected_open);
                    let recorded_liability = env.as_contract(&contract, || {
                        storage::read_liability(&env, asset)
                    });
                    prop_assert_eq!(recorded_liability, expected_open);
                    if let Ok(Ok(queried)) = client.try_get_escrow_liability(asset) {
                        prop_assert_eq!(queried, expected_open);
                    }
                }
            }
            Ok(())
        })
        .unwrap_or_else(|err| {
            panic!(
                "refund destination pinning failed (replay with LUMENBAZAAR_REFUND_SEED=0x{:016x}): {err}",
                seed
            );
        });
}
