extern crate std;

use std::vec;
use crate::*;
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
const EXPIRY_LEDGER: u32 = 50;

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

    #[test]
    fn arbitrary_lifecycle_sequences_preserve_conservation_and_caps(
        ops in arbitrary_lifecycle_strategy(),
    ) {
        run_arbitrary_lifecycle_sequence(&ops);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PropLifecycleOp {
    CreateSession { buyer_idx: u8, seller_idx: u8, asset_idx: u8, amount_selector: u8, duration_ledgers: u32, authorized: bool },
    Settle { session_idx: u8, amount_selector: u8, authorized: bool },
    Cancel { session_idx: u8, authorized: bool },
    Reject { session_idx: u8, authorized: bool },
    RecoverExpired { session_idx: u8 },
    RecoverExpiredBatch { session_idx: u8 },
    ExtendSessionExpiry { session_idx: u8, buyer_auth: bool, seller_auth: bool, extension_ledgers: u32 },
    ReduceSessionCap { session_idx: u8, reduction_amount: i128, authorized: bool },
    SetAssetMaxSessionAmount { asset_idx: u8, new_max: i128, authorized: bool },
    ProposeAssetCapIncrease { asset_idx: u8, new_cap: i128, authorized: bool },
    AcceptAssetCapIncrease { asset_idx: u8, authorized: bool },
    CancelAssetCapIncrease { asset_idx: u8, authorized: bool },
    SetAssetExposureCeiling { asset_idx: u8, ceiling: i128, authorized: bool },
    SetBuyerExposureCeiling { asset_idx: u8, ceiling: i128, authorized: bool },
    SetSellerExposureCeiling { asset_idx: u8, ceiling: i128, authorized: bool },
    SetMaxBuyerOpenSessions { limit: u32, authorized: bool },
    SetMaxSellerOpenSessions { limit: u32, authorized: bool },
    ActivateAsset { asset_idx: u8, authorized: bool },
    DeprecateAsset { asset_idx: u8, authorized: bool },
    RemoveAsset { asset_idx: u8, authorized: bool },
    ProposeAdmin { pending_idx: u8, duration: u32, authorized: bool },
    AcceptAdmin { caller_idx: u8, authorized: bool },
    CancelAdminRotation { authorized: bool },
    PauseCreation { authorized: bool },
    ResumeCreation { authorized: bool },
    AdvanceLedger { delta: u32 },
}

fn arbitrary_lifecycle_strategy() -> impl Strategy<Value = std::vec::Vec<PropLifecycleOp>> {
    let op_strategy = prop_oneof![
        (0..2u8, 0..2u8, 0..2u8, 0..4u8, prop_oneof![Just(50u32), Just(200u32), Just(500u32)], any::<bool>())
            .prop_map(|(b, s, a, am, d, auth)| PropLifecycleOp::CreateSession {
                buyer_idx: b, seller_idx: s, asset_idx: a, amount_selector: am, duration_ledgers: d, authorized: auth
            }),
        (0..4u8, 0..5u8, any::<bool>())
            .prop_map(|(s, am, auth)| PropLifecycleOp::Settle { session_idx: s, amount_selector: am, authorized: auth }),
        (0..4u8, any::<bool>())
            .prop_map(|(s, auth)| PropLifecycleOp::Cancel { session_idx: s, authorized: auth }),
        (0..4u8, any::<bool>())
            .prop_map(|(s, auth)| PropLifecycleOp::Reject { session_idx: s, authorized: auth }),
        (0..4u8).prop_map(|s| PropLifecycleOp::RecoverExpired { session_idx: s }),
        (0..4u8).prop_map(|s| PropLifecycleOp::RecoverExpiredBatch { session_idx: s }),
        (0..4u8, any::<bool>(), any::<bool>(), prop_oneof![Just(50u32), Just(200u32)])
            .prop_map(|(s, b, se, ext)| PropLifecycleOp::ExtendSessionExpiry {
                session_idx: s, buyer_auth: b, seller_auth: se, extension_ledgers: ext
            }),
        (0..4u8, prop_oneof![Just(50i128), Just(100i128), Just(500i128)], any::<bool>())
            .prop_map(|(s, red, auth)| PropLifecycleOp::ReduceSessionCap {
                session_idx: s, reduction_amount: red, authorized: auth
            }),
        (0..2u8, prop_oneof![Just(500i128), Just(800i128)], any::<bool>())
            .prop_map(|(a, m, auth)| PropLifecycleOp::SetAssetMaxSessionAmount { asset_idx: a, new_max: m, authorized: auth }),
        (0..2u8, prop_oneof![Just(1_500i128), Just(2_000i128)], any::<bool>())
            .prop_map(|(a, c, auth)| PropLifecycleOp::ProposeAssetCapIncrease { asset_idx: a, new_cap: c, authorized: auth }),
        (0..2u8, any::<bool>())
            .prop_map(|(a, auth)| PropLifecycleOp::AcceptAssetCapIncrease { asset_idx: a, authorized: auth }),
        (0..2u8, any::<bool>())
            .prop_map(|(a, auth)| PropLifecycleOp::CancelAssetCapIncrease { asset_idx: a, authorized: auth }),
        (0..2u8, prop_oneof![Just(50_000i128), Just(100_000i128)], any::<bool>())
            .prop_map(|(a, c, auth)| PropLifecycleOp::SetAssetExposureCeiling { asset_idx: a, ceiling: c, authorized: auth }),
        (0..2u8, prop_oneof![Just(25_000i128), Just(50_000i128)], any::<bool>())
            .prop_map(|(a, c, auth)| PropLifecycleOp::SetBuyerExposureCeiling { asset_idx: a, ceiling: c, authorized: auth }),
        (0..2u8, prop_oneof![Just(25_000i128), Just(50_000i128)], any::<bool>())
            .prop_map(|(a, c, auth)| PropLifecycleOp::SetSellerExposureCeiling { asset_idx: a, ceiling: c, authorized: auth }),
        (prop_oneof![Just(5u32), Just(10u32)], any::<bool>())
            .prop_map(|(l, auth)| PropLifecycleOp::SetMaxBuyerOpenSessions { limit: l, authorized: auth }),
        (prop_oneof![Just(5u32), Just(10u32)], any::<bool>())
            .prop_map(|(l, auth)| PropLifecycleOp::SetMaxSellerOpenSessions { limit: l, authorized: auth }),
        (0..2u8, any::<bool>())
            .prop_map(|(a, auth)| PropLifecycleOp::ActivateAsset { asset_idx: a, authorized: auth }),
        (0..2u8, any::<bool>())
            .prop_map(|(a, auth)| PropLifecycleOp::DeprecateAsset { asset_idx: a, authorized: auth }),
        (0..2u8, any::<bool>())
            .prop_map(|(a, auth)| PropLifecycleOp::RemoveAsset { asset_idx: a, authorized: auth }),
        (prop_oneof![Just(1u8), Just(2u8)], prop_oneof![Just(50u32), Just(100u32)], any::<bool>())
            .prop_map(|(p, d, auth)| PropLifecycleOp::ProposeAdmin { pending_idx: p, duration: d, authorized: auth }),
        (prop_oneof![Just(1u8), Just(2u8)], any::<bool>())
            .prop_map(|(c, auth)| PropLifecycleOp::AcceptAdmin { caller_idx: c, authorized: auth }),
        any::<bool>().prop_map(|auth| PropLifecycleOp::CancelAdminRotation { authorized: auth }),
        any::<bool>().prop_map(|auth| PropLifecycleOp::PauseCreation { authorized: auth }),
        any::<bool>().prop_map(|auth| PropLifecycleOp::ResumeCreation { authorized: auth }),
        prop_oneof![Just(10u32), Just(60u32), Just(300u32)].prop_map(|d| PropLifecycleOp::AdvanceLedger { delta: d }),
    ];
    collection::vec(op_strategy, 1..24)
}

fn run_arbitrary_lifecycle_sequence(ops: &[PropLifecycleOp]) {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let pending_admin = Address::generate(&env);
    let attacker = Address::generate(&env);

    let buyers = [Address::generate(&env), Address::generate(&env)];
    let sellers = [Address::generate(&env), Address::generate(&env)];

    let initial_mint: i128 = 50_000;
    let initial_cap: i128 = 1_000;

    let create_test_token = |mint_to: &[Address]| -> Address {
        let token_admin = Address::generate(&env);
        let a = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let tc = token::StellarAssetClient::new(&env, &a);
        for recipient in mint_to {
            tc.mock_auths(&[MockAuth {
                address: &token_admin,
                invoke: &MockAuthInvoke {
                    contract: &a,
                    fn_name: "mint",
                    args: (recipient.clone(), initial_mint).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .mint(recipient, &initial_mint);
        }
        a
    };

    let assets = [
        create_test_token(&buyers),
        create_test_token(&buyers),
    ];

    let initial_policies = soroban_sdk::vec![
        &env,
        AssetPolicy {
            asset: assets[0].clone(),
            max_session_amount: initial_cap,
            min_session_amount: 1,
            max_asset_exposure: initial_mint,
            max_buyer_exposure: initial_mint,
        },
        AssetPolicy {
            asset: assets[1].clone(),
            max_session_amount: initial_cap,
            min_session_amount: 1,
            max_asset_exposure: initial_mint,
            max_buyer_exposure: initial_mint,
        }
    ];

    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "initialize",
                args: (admin.clone(), initial_policies.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .initialize(&admin, &initial_policies);

    let mut current_ledger = 100_u32;
    env.ledger().set_sequence_number(current_ledger);

    let resource_hash = BytesN::from_array(&env, &[1; 32]);
    let usage_hash = BytesN::from_array(&env, &[2; 32]);
    let reason_hash = BytesN::from_array(&env, &[3; 32]);

    let mut sessions: std::vec::Vec<BytesN<32>> = std::vec::Vec::new();
    let mut current_admin = admin.clone();

    for op in ops {
        match *op {
            PropLifecycleOp::CreateSession {
                buyer_idx,
                seller_idx,
                asset_idx,
                amount_selector,
                duration_ledgers,
                authorized,
            } => {
                let b = &buyers[(buyer_idx as usize) % 2];
                let s = &sellers[(seller_idx as usize) % 2];
                let a = &assets[(asset_idx as usize) % 2];
                let caller = if authorized { b.clone() } else { attacker.clone() };

                let amount = match amount_selector {
                    0 => 0,
                    1 => 1,
                    2 => initial_cap / 2,
                    3 => initial_cap,
                    _ => initial_cap + 1,
                };
                let expires_at = current_ledger + duration_ledgers;

                let res = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "create_session",
                            args: (
                                caller.clone(),
                                s.clone(),
                                a.clone(),
                                amount,
                                expires_at,
                                resource_hash.clone(),
                            )
                                .into_val(&env),
                            sub_invokes: &[MockAuthInvoke {
                                contract: a,
                                fn_name: "transfer",
                                args: (
                                    caller.clone(),
                                    contract_id.clone(),
                                    amount,
                                )
                                    .into_val(&env),
                                sub_invokes: &[],
                            }],
                        },
                    }])
                    .try_create_session(&caller, s, a, &amount, &expires_at, &resource_hash);

                if let Ok(Ok(sid)) = res {
                    sessions.push(sid);
                }
            }
            PropLifecycleOp::Settle {
                session_idx,
                amount_selector,
                authorized,
            } => {
                if !sessions.is_empty() {
                    let sid = &sessions[(session_idx as usize) % sessions.len()];
                    let s = if let Ok(Ok(sess)) = client.try_get_session(sid) {
                        sess.seller
                    } else {
                        sellers[0].clone()
                    };
                    let caller = if authorized { s.clone() } else { attacker.clone() };

                    let amount = match amount_selector {
                        0 => 0,
                        1 => 1,
                        2 => initial_cap / 2,
                        3 => initial_cap,
                        _ => initial_cap + 1,
                    };

                    let _ = client
                        .mock_auths(&[MockAuth {
                            address: &caller,
                            invoke: &MockAuthInvoke {
                                contract: &contract_id,
                                fn_name: "settle",
                                args: (sid.clone(), amount, usage_hash.clone()).into_val(&env),
                                sub_invokes: &[],
                            },
                        }])
                        .try_settle(sid, &amount, &usage_hash);
                }
            }
            PropLifecycleOp::Cancel {
                session_idx,
                authorized,
            } => {
                if !sessions.is_empty() {
                    let sid = &sessions[(session_idx as usize) % sessions.len()];
                    let b = if let Ok(Ok(sess)) = client.try_get_session(sid) {
                        sess.buyer
                    } else {
                        buyers[0].clone()
                    };
                    let caller = if authorized { b.clone() } else { attacker.clone() };

                    let _ = client
                        .mock_auths(&[MockAuth {
                            address: &caller,
                            invoke: &MockAuthInvoke {
                                contract: &contract_id,
                                fn_name: "cancel",
                                args: (sid.clone(),).into_val(&env),
                                sub_invokes: &[],
                            },
                        }])
                        .try_cancel(sid);
                }
            }
            PropLifecycleOp::Reject {
                session_idx,
                authorized,
            } => {
                if !sessions.is_empty() {
                    let sid = &sessions[(session_idx as usize) % sessions.len()];
                    let s = if let Ok(Ok(sess)) = client.try_get_session(sid) {
                        sess.seller
                    } else {
                        sellers[0].clone()
                    };
                    let caller = if authorized { s.clone() } else { attacker.clone() };

                    let _ = client
                        .mock_auths(&[MockAuth {
                            address: &caller,
                            invoke: &MockAuthInvoke {
                                contract: &contract_id,
                                fn_name: "reject",
                                args: (sid.clone(),).into_val(&env),
                                sub_invokes: &[],
                            },
                        }])
                        .try_reject(sid);
                }
            }
            PropLifecycleOp::RecoverExpired { session_idx } => {
                if !sessions.is_empty() {
                    let sid = &sessions[(session_idx as usize) % sessions.len()];
                    let _ = client.try_recover_expired(sid);
                }
            }
            PropLifecycleOp::RecoverExpiredBatch { session_idx } => {
                if !sessions.is_empty() {
                    let mut batch = soroban_sdk::Vec::new(&env);
                    batch.push_back(sessions[(session_idx as usize) % sessions.len()].clone());
                    let _ = client.recover_expired_batch(&batch);
                }
            }
            PropLifecycleOp::ExtendSessionExpiry {
                session_idx,
                buyer_auth,
                seller_auth,
                extension_ledgers,
            } => {
                if !sessions.is_empty() {
                    let sid = &sessions[(session_idx as usize) % sessions.len()];
                    if let Ok(Ok(sess)) = client.try_get_session(sid) {
                        let new_expiry = sess.expires_at_ledger + extension_ledgers;
                        let b_caller = if buyer_auth { sess.buyer.clone() } else { attacker.clone() };
                        let s_caller = if seller_auth { sess.seller.clone() } else { attacker.clone() };

                        let _ = client
                            .mock_auths(&[
                                MockAuth {
                                    address: &b_caller,
                                    invoke: &MockAuthInvoke {
                                        contract: &contract_id,
                                        fn_name: "extend_session_expiry",
                                        args: (sid.clone(), new_expiry).into_val(&env),
                                        sub_invokes: &[],
                                    },
                                },
                                MockAuth {
                                    address: &s_caller,
                                    invoke: &MockAuthInvoke {
                                        contract: &contract_id,
                                        fn_name: "extend_session_expiry",
                                        args: (sid.clone(), new_expiry).into_val(&env),
                                        sub_invokes: &[],
                                    },
                                },
                            ])
                            .try_extend_session_expiry(sid, &new_expiry);
                    }
                }
            }
            PropLifecycleOp::ReduceSessionCap {
                session_idx,
                reduction_amount,
                authorized,
            } => {
                if !sessions.is_empty() {
                    let sid = &sessions[(session_idx as usize) % sessions.len()];
                    if let Ok(Ok(sess)) = client.try_get_session(sid) {
                        let new_cap = (sess.max_amount - reduction_amount).max(0);
                        let caller = if authorized { sess.buyer.clone() } else { attacker.clone() };

                        let _ = client
                            .mock_auths(&[MockAuth {
                                address: &caller,
                                invoke: &MockAuthInvoke {
                                    contract: &contract_id,
                                    fn_name: "reduce_session_cap",
                                    args: (sid.clone(), new_cap).into_val(&env),
                                    sub_invokes: &[],
                                },
                            }])
                            .try_reduce_session_cap(sid, &new_cap);
                    }
                }
            }
            PropLifecycleOp::SetAssetMaxSessionAmount {
                asset_idx,
                new_max,
                authorized,
            } => {
                let a = &assets[(asset_idx as usize) % 2];
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "set_asset_max_session_amount",
                            args: (a.clone(), new_max).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_set_asset_max_session_amount(a, &new_max);
            }
            PropLifecycleOp::ProposeAssetCapIncrease {
                asset_idx,
                new_cap,
                authorized,
            } => {
                let a = &assets[(asset_idx as usize) % 2];
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let valid_from = current_ledger + 10;
                let expires_at = current_ledger + 100;
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "propose_asset_cap_increase",
                            args: (a.clone(), new_cap, valid_from, expires_at).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_propose_asset_cap_increase(a, &new_cap, &valid_from, &expires_at);
            }
            PropLifecycleOp::AcceptAssetCapIncrease { asset_idx, authorized } => {
                let a = &assets[(asset_idx as usize) % 2];
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "accept_asset_cap_increase",
                            args: (a.clone(),).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_accept_asset_cap_increase(a);
            }
            PropLifecycleOp::CancelAssetCapIncrease { asset_idx, authorized } => {
                let a = &assets[(asset_idx as usize) % 2];
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "cancel_asset_cap_increase",
                            args: (a.clone(),).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_cancel_asset_cap_increase(a);
            }
            PropLifecycleOp::SetAssetExposureCeiling { asset_idx, ceiling, authorized } => {
                let a = &assets[(asset_idx as usize) % 2];
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "set_asset_exposure_ceiling",
                            args: (a.clone(), ceiling).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_set_asset_exposure_ceiling(a, &ceiling);
            }
            PropLifecycleOp::SetBuyerExposureCeiling { asset_idx, ceiling, authorized } => {
                let a = &assets[(asset_idx as usize) % 2];
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "set_buyer_exposure_ceiling",
                            args: (a.clone(), ceiling).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_set_buyer_exposure_ceiling(a, &ceiling);
            }
            PropLifecycleOp::SetSellerExposureCeiling { asset_idx, ceiling, authorized } => {
                let a = &assets[(asset_idx as usize) % 2];
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "set_seller_exposure_ceiling",
                            args: (a.clone(), ceiling).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_set_seller_exposure_ceiling(a, &ceiling);
            }
            PropLifecycleOp::SetMaxBuyerOpenSessions { limit, authorized } => {
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "set_max_buyer_open_sessions",
                            args: (limit,).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_set_max_buyer_open_sessions(&limit);
            }
            PropLifecycleOp::SetMaxSellerOpenSessions { limit, authorized } => {
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "set_max_seller_open_sessions",
                            args: (limit,).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_set_max_seller_open_sessions(&limit);
            }
            PropLifecycleOp::ActivateAsset { asset_idx, authorized } => {
                let a = &assets[(asset_idx as usize) % 2];
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let policy = AssetPolicy {
                    asset: a.clone(),
                    max_session_amount: initial_cap,
                    min_session_amount: 1,
                    max_asset_exposure: initial_mint,
                    max_buyer_exposure: initial_mint,
                };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "activate_asset",
                            args: (policy.clone(),).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_activate_asset(&policy);
            }
            PropLifecycleOp::DeprecateAsset { asset_idx, authorized } => {
                let a = &assets[(asset_idx as usize) % 2];
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "deprecate_asset",
                            args: (a.clone(), reason_hash.clone()).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_deprecate_asset(a, &reason_hash);
            }
            PropLifecycleOp::RemoveAsset { asset_idx, authorized } => {
                let a = &assets[(asset_idx as usize) % 2];
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "remove_asset",
                            args: (a.clone(), reason_hash.clone()).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_remove_asset(a, &reason_hash);
            }
            PropLifecycleOp::ProposeAdmin { pending_idx: _, duration, authorized } => {
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let expires_at = current_ledger + duration;
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "propose_admin",
                            args: (pending_admin.clone(), expires_at).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_propose_admin(&pending_admin, &expires_at);
            }
            PropLifecycleOp::AcceptAdmin { caller_idx: _, authorized } => {
                let caller = if authorized { pending_admin.clone() } else { attacker.clone() };
                if client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "accept_admin",
                            args: ().into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_accept_admin()
                    .is_ok()
                {
                    current_admin = pending_admin.clone();
                }
            }
            PropLifecycleOp::CancelAdminRotation { authorized } => {
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "cancel_admin_rotation",
                            args: ().into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_cancel_admin_rotation();
            }
            PropLifecycleOp::PauseCreation { authorized } => {
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "pause_creation",
                            args: ().into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_pause_creation();
            }
            PropLifecycleOp::ResumeCreation { authorized } => {
                let caller = if authorized { current_admin.clone() } else { attacker.clone() };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "resume_creation",
                            args: ().into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_resume_creation();
            }
            PropLifecycleOp::AdvanceLedger { delta } => {
                current_ledger = current_ledger.saturating_add(delta);
                env.ledger().set_sequence_number(current_ledger);
            }
        }

        // Global conservation & liability invariant check after every operation
        for asset in &assets {
            let tc = token::Client::new(&env, asset);
            let mut total_balance: i128 = tc.balance(&contract_id);
            for b in &buyers {
                total_balance = total_balance.checked_add(tc.balance(b)).expect("no overflow");
            }
            for s in &sellers {
                total_balance = total_balance.checked_add(tc.balance(s)).expect("no overflow");
            }
            total_balance = total_balance.checked_add(tc.balance(&attacker)).expect("no overflow");

            let expected_total = initial_mint * (buyers.len() as i128);
            assert_eq!(
                total_balance, expected_total,
                "Funds conservation violated for asset"
            );

            if client.try_get_configuration().is_ok() {
                if let Ok(Ok(liability)) = client.try_get_escrow_liability(asset) {
                    assert!(liability >= 0, "Escrow liability cannot be negative");
                    assert!(
                        liability <= tc.balance(&contract_id),
                        "Escrow liability cannot exceed contract token balance"
                    );
                }
            }
        }
    }
}
