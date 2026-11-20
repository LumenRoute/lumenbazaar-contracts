//! Arbitrary lifecycle operation sequence generator.
//!
//! Generates and executes bounded session, policy, asset, and administrator operations
//! with state-dependent inputs and both authorized and unauthorized callers.
//!
//! On failure, the seed and minimal reduced/shrunk sequence are reported.

use crate::SplitMix64;
use core::fmt::Debug;
use serde::{Deserialize, Serialize};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    token, Address, BytesN, Env, IntoVal,
};
use upto_session::{AssetPolicy, UptoSessionContract, UptoSessionContractClient};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum AmountKind {
    Zero,
    One,
    Half,
    ExactCap,
    OverCap,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LifecycleOp {
    // Session operations:
    CreateSession {
        buyer_idx: u8,
        seller_idx: u8,
        asset_idx: u8,
        amount_kind: AmountKind,
        duration_ledgers: u32,
        authorized: bool,
    },
    Settle {
        session_idx: u8,
        seller_idx: u8,
        amount_kind: AmountKind,
        authorized: bool,
    },
    Cancel {
        session_idx: u8,
        buyer_idx: u8,
        authorized: bool,
    },
    Reject {
        session_idx: u8,
        seller_idx: u8,
        authorized: bool,
    },
    RecoverExpired {
        session_idx: u8,
    },
    RecoverExpiredBatch {
        session_indices: Vec<u8>,
    },
    ExtendSessionExpiry {
        session_idx: u8,
        buyer_authorized: bool,
        seller_authorized: bool,
        new_duration: u32,
    },
    ReduceSessionCap {
        session_idx: u8,
        buyer_authorized: bool,
        reduced_amount: i128,
    },

    // Policy operations:
    SetAssetMaxSessionAmount {
        asset_idx: u8,
        new_max: i128,
        authorized: bool,
    },
    ProposeAssetCapIncrease {
        asset_idx: u8,
        new_cap: i128,
        authorized: bool,
    },
    AcceptAssetCapIncrease {
        asset_idx: u8,
        authorized: bool,
    },
    CancelAssetCapIncrease {
        asset_idx: u8,
        authorized: bool,
    },
    SetAssetExposureCeiling {
        asset_idx: u8,
        ceiling: i128,
        authorized: bool,
    },
    SetBuyerExposureCeiling {
        asset_idx: u8,
        ceiling: i128,
        authorized: bool,
    },
    SetSellerExposureCeiling {
        asset_idx: u8,
        ceiling: i128,
        authorized: bool,
    },
    SetMaxBuyerOpenSessions {
        limit: u32,
        authorized: bool,
    },
    SetMaxSellerOpenSessions {
        limit: u32,
        authorized: bool,
    },

    // Asset operations:
    ActivateAsset {
        asset_idx: u8,
        authorized: bool,
    },
    DeprecateAsset {
        asset_idx: u8,
        authorized: bool,
    },
    RemoveAsset {
        asset_idx: u8,
        authorized: bool,
    },

    // Administrator operations:
    ProposeAdmin {
        pending_idx: u8,
        duration: u32,
        authorized: bool,
    },
    AcceptAdmin {
        caller_idx: u8,
        authorized: bool,
    },
    CancelAdminRotation {
        authorized: bool,
    },
    PauseCreation {
        authorized: bool,
    },
    ResumeCreation {
        authorized: bool,
    },
    AdvanceLedger {
        delta: u32,
    },
}

/// Reusable generator producing state-dependent lifecycle operation sequences.
pub struct LifecycleGenerator {
    rng: SplitMix64,
}

impl LifecycleGenerator {
    pub fn new(seed: u64) -> Self {
        Self {
            rng: SplitMix64::new(seed),
        }
    }

    pub fn from_bytes(bytes: &[u8]) -> Self {
        let mut seed = 0x4c49_4645_4359_434c; // "LIFECYCL"
        for chunk in bytes.chunks(8) {
            let mut buf = [0u8; 8];
            buf[..chunk.len()].copy_from_slice(chunk);
            seed ^= u64::from_le_bytes(buf);
        }
        Self::new(seed)
    }

    /// Generates between 1 and `max_ops` operations with state-dependent inputs and both
    /// authorized and unauthorized histories.
    pub fn generate(&mut self, max_ops: usize) -> Vec<LifecycleOp> {
        let count = 1 + (self.rng.next_u64() as usize % max_ops.max(1));
        let mut ops = Vec::with_capacity(count);

        for _ in 0..count {
            let op_type = (self.rng.next_u64() % 23) as u8;
            let authorized = !self.rng.next_u64().is_multiple_of(3); // ~66% authorized, ~33% unauthorized

            let op = match op_type {
                0 => LifecycleOp::CreateSession {
                    buyer_idx: (self.rng.next_u64() % 2) as u8,
                    seller_idx: (self.rng.next_u64() % 2) as u8,
                    asset_idx: (self.rng.next_u64() % 2) as u8,
                    amount_kind: match self.rng.next_u64() % 4 {
                        0 => AmountKind::One,
                        1 => AmountKind::Half,
                        2 => AmountKind::ExactCap,
                        _ => AmountKind::OverCap,
                    },
                    duration_ledgers: match self.rng.next_u64() % 3 {
                        0 => 50,
                        1 => 200,
                        _ => 1_000,
                    },
                    authorized,
                },
                1 => LifecycleOp::Settle {
                    session_idx: (self.rng.next_u64() % 4) as u8,
                    seller_idx: (self.rng.next_u64() % 2) as u8,
                    amount_kind: match self.rng.next_u64() % 5 {
                        0 => AmountKind::Zero,
                        1 => AmountKind::One,
                        2 => AmountKind::Half,
                        3 => AmountKind::ExactCap,
                        _ => AmountKind::OverCap,
                    },
                    authorized,
                },
                2 => LifecycleOp::Cancel {
                    session_idx: (self.rng.next_u64() % 4) as u8,
                    buyer_idx: (self.rng.next_u64() % 2) as u8,
                    authorized,
                },
                3 => LifecycleOp::Reject {
                    session_idx: (self.rng.next_u64() % 4) as u8,
                    seller_idx: (self.rng.next_u64() % 2) as u8,
                    authorized,
                },
                4 => LifecycleOp::RecoverExpired {
                    session_idx: (self.rng.next_u64() % 4) as u8,
                },
                5 => LifecycleOp::RecoverExpiredBatch {
                    session_indices: vec![0, 1],
                },
                6 => LifecycleOp::ExtendSessionExpiry {
                    session_idx: (self.rng.next_u64() % 4) as u8,
                    buyer_authorized: authorized,
                    seller_authorized: authorized || self.rng.next_u64().is_multiple_of(2),
                    new_duration: 300,
                },
                7 => LifecycleOp::ReduceSessionCap {
                    session_idx: (self.rng.next_u64() % 4) as u8,
                    buyer_authorized: authorized,
                    reduced_amount: 50,
                },
                8 => LifecycleOp::SetAssetMaxSessionAmount {
                    asset_idx: (self.rng.next_u64() % 2) as u8,
                    new_max: 500, // immediate step down
                    authorized,
                },
                9 => LifecycleOp::ProposeAssetCapIncrease {
                    asset_idx: (self.rng.next_u64() % 2) as u8,
                    new_cap: 2_000,
                    authorized,
                },
                10 => LifecycleOp::AcceptAssetCapIncrease {
                    asset_idx: (self.rng.next_u64() % 2) as u8,
                    authorized,
                },
                11 => LifecycleOp::CancelAssetCapIncrease {
                    asset_idx: (self.rng.next_u64() % 2) as u8,
                    authorized,
                },
                12 => LifecycleOp::SetAssetExposureCeiling {
                    asset_idx: (self.rng.next_u64() % 2) as u8,
                    ceiling: 50_000,
                    authorized,
                },
                13 => LifecycleOp::SetBuyerExposureCeiling {
                    asset_idx: (self.rng.next_u64() % 2) as u8,
                    ceiling: 25_000,
                    authorized,
                },
                14 => LifecycleOp::SetSellerExposureCeiling {
                    asset_idx: (self.rng.next_u64() % 2) as u8,
                    ceiling: 25_000,
                    authorized,
                },
                15 => LifecycleOp::SetMaxBuyerOpenSessions {
                    limit: 10,
                    authorized,
                },
                16 => LifecycleOp::SetMaxSellerOpenSessions {
                    limit: 10,
                    authorized,
                },
                17 => LifecycleOp::ActivateAsset {
                    asset_idx: 1,
                    authorized,
                },
                18 => LifecycleOp::DeprecateAsset {
                    asset_idx: 0,
                    authorized,
                },
                19 => LifecycleOp::RemoveAsset {
                    asset_idx: 0,
                    authorized,
                },
                20 => LifecycleOp::ProposeAdmin {
                    pending_idx: 1,
                    duration: 100,
                    authorized,
                },
                21 => LifecycleOp::AcceptAdmin {
                    caller_idx: 1,
                    authorized,
                },
                _ => LifecycleOp::AdvanceLedger {
                    delta: match self.rng.next_u64() % 3 {
                        0 => 10,
                        1 => 60,
                        _ => 300,
                    },
                },
            };

            ops.push(op);
        }

        ops
    }
}

/// Runs a sequence of lifecycle operations, asserting global protocol invariants.
/// Reports seed and reduced sequence on failure.
pub fn run_lifecycle_sequence(seed: u64, ops: &[LifecycleOp]) {
    if let Err(panic) = std::panic::catch_unwind(|| execute_lifecycle_sequence(ops)) {
        eprintln!("\n=======================================================");
        eprintln!("LIFECYCLE TEST FAILURE!");
        eprintln!("Seed: 0x{seed:016x} ({seed})");
        eprintln!("Original sequence length: {}", ops.len());

        // Attempt sequence reduction (shrinking):
        let mut reduced = ops.to_vec();
        for i in (0..reduced.len()).rev() {
            let mut candidate = reduced.clone();
            candidate.remove(i);
            if std::panic::catch_unwind(|| execute_lifecycle_sequence(&candidate)).is_err() {
                reduced = candidate;
            }
        }

        eprintln!("Minimal reduced sequence ({} ops):", reduced.len());
        for (idx, op) in reduced.iter().enumerate() {
            eprintln!("  {idx}. {op:?}");
        }
        eprintln!("=======================================================\n");
        std::panic::resume_unwind(panic);
    }
}

const INITIAL_CAP: i128 = 1_000;
const INITIAL_MINT: i128 = 50_000;

fn execute_lifecycle_sequence(ops: &[LifecycleOp]) {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let pending_admin = Address::generate(&env);
    let attacker = Address::generate(&env);

    let buyers = [Address::generate(&env), Address::generate(&env)];
    let sellers = [Address::generate(&env), Address::generate(&env)];

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
                    args: (recipient.clone(), INITIAL_MINT).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .mint(recipient, &INITIAL_MINT);
        }
        a
    };

    let assets = [create_test_token(&buyers), create_test_token(&buyers)];

    let initial_policies = soroban_sdk::vec![
        &env,
        AssetPolicy {
            asset: assets[0].clone(),
            max_session_amount: INITIAL_CAP,
            min_session_amount: 1,
            max_asset_exposure: INITIAL_MINT,
            max_buyer_exposure: INITIAL_MINT,
        },
        AssetPolicy {
            asset: assets[1].clone(),
            max_session_amount: INITIAL_CAP,
            min_session_amount: 1,
            max_asset_exposure: INITIAL_MINT,
            max_buyer_exposure: INITIAL_MINT,
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

    let mut sessions: Vec<BytesN<32>> = Vec::new();
    let mut current_admin = admin.clone();

    for op in ops {
        match op {
            LifecycleOp::CreateSession {
                buyer_idx,
                seller_idx,
                asset_idx,
                amount_kind,
                duration_ledgers,
                authorized,
            } => {
                let b = &buyers[(*buyer_idx as usize) % 2];
                let s = &sellers[(*seller_idx as usize) % 2];
                let a = &assets[(*asset_idx as usize) % 2];
                let caller = if *authorized {
                    b.clone()
                } else {
                    attacker.clone()
                };

                let amount = match amount_kind {
                    AmountKind::Zero => 0,
                    AmountKind::One => 1,
                    AmountKind::Half => INITIAL_CAP / 2,
                    AmountKind::ExactCap => INITIAL_CAP,
                    AmountKind::OverCap => INITIAL_CAP + 1,
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
                                args: (caller.clone(), contract_id.clone(), amount).into_val(&env),
                                sub_invokes: &[],
                            }],
                        },
                    }])
                    .try_create_session(&caller, s, a, &amount, &expires_at, &resource_hash);

                if let Ok(Ok(sid)) = res {
                    sessions.push(sid);
                }
            }
            LifecycleOp::Settle {
                session_idx,
                seller_idx,
                amount_kind,
                authorized,
            } => {
                if !sessions.is_empty() {
                    let sid = &sessions[(*session_idx as usize) % sessions.len()];
                    let s = &sellers[(*seller_idx as usize) % 2];
                    let caller = if *authorized {
                        s.clone()
                    } else {
                        attacker.clone()
                    };

                    let amount = match amount_kind {
                        AmountKind::Zero => 0,
                        AmountKind::One => 1,
                        AmountKind::Half => INITIAL_CAP / 2,
                        AmountKind::ExactCap => INITIAL_CAP,
                        AmountKind::OverCap => INITIAL_CAP + 1,
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
            LifecycleOp::Cancel {
                session_idx,
                buyer_idx,
                authorized,
            } => {
                if !sessions.is_empty() {
                    let sid = &sessions[(*session_idx as usize) % sessions.len()];
                    let b = &buyers[(*buyer_idx as usize) % 2];
                    let caller = if *authorized {
                        b.clone()
                    } else {
                        attacker.clone()
                    };

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
            LifecycleOp::Reject {
                session_idx,
                seller_idx,
                authorized,
            } => {
                if !sessions.is_empty() {
                    let sid = &sessions[(*session_idx as usize) % sessions.len()];
                    let s = &sellers[(*seller_idx as usize) % 2];
                    let caller = if *authorized {
                        s.clone()
                    } else {
                        attacker.clone()
                    };

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
            LifecycleOp::RecoverExpired { session_idx } => {
                if !sessions.is_empty() {
                    let sid = &sessions[(*session_idx as usize) % sessions.len()];
                    let _ = client.try_recover_expired(sid);
                }
            }
            LifecycleOp::RecoverExpiredBatch { session_indices } => {
                if !sessions.is_empty() {
                    let mut batch = soroban_sdk::Vec::new(&env);
                    for idx in session_indices {
                        batch.push_back(sessions[(*idx as usize) % sessions.len()].clone());
                    }
                    let _ = client.recover_expired_batch(&batch);
                }
            }
            LifecycleOp::ExtendSessionExpiry {
                session_idx,
                buyer_authorized,
                seller_authorized,
                new_duration,
            } => {
                if !sessions.is_empty() {
                    let sid = &sessions[(*session_idx as usize) % sessions.len()];
                    if let Ok(Ok(sess)) = client.try_get_session(sid) {
                        let new_expiry = sess.expires_at_ledger + new_duration;
                        let b_caller = if *buyer_authorized {
                            sess.buyer.clone()
                        } else {
                            attacker.clone()
                        };
                        let s_caller = if *seller_authorized {
                            sess.seller.clone()
                        } else {
                            attacker.clone()
                        };

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
            LifecycleOp::ReduceSessionCap {
                session_idx,
                buyer_authorized,
                reduced_amount,
            } => {
                if !sessions.is_empty() {
                    let sid = &sessions[(*session_idx as usize) % sessions.len()];
                    if let Ok(Ok(sess)) = client.try_get_session(sid) {
                        let new_cap = (sess.max_amount - reduced_amount).max(0);
                        let caller = if *buyer_authorized {
                            sess.buyer.clone()
                        } else {
                            attacker.clone()
                        };

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
            LifecycleOp::SetAssetMaxSessionAmount {
                asset_idx,
                new_max,
                authorized,
            } => {
                let a = &assets[(*asset_idx as usize) % 2];
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "set_asset_max_session_amount",
                            args: (a.clone(), *new_max).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_set_asset_max_session_amount(a, new_max);
            }
            LifecycleOp::ProposeAssetCapIncrease {
                asset_idx,
                new_cap,
                authorized,
            } => {
                let a = &assets[(*asset_idx as usize) % 2];
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
                let valid_from = current_ledger + 10;
                let expires_at = current_ledger + 100;
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "propose_asset_cap_increase",
                            args: (a.clone(), *new_cap, valid_from, expires_at).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_propose_asset_cap_increase(a, new_cap, &valid_from, &expires_at);
            }
            LifecycleOp::AcceptAssetCapIncrease {
                asset_idx,
                authorized,
            } => {
                let a = &assets[(*asset_idx as usize) % 2];
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
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
            LifecycleOp::CancelAssetCapIncrease {
                asset_idx,
                authorized,
            } => {
                let a = &assets[(*asset_idx as usize) % 2];
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
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
            LifecycleOp::SetAssetExposureCeiling {
                asset_idx,
                ceiling,
                authorized,
            } => {
                let a = &assets[(*asset_idx as usize) % 2];
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "set_asset_exposure_ceiling",
                            args: (a.clone(), *ceiling).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_set_asset_exposure_ceiling(a, ceiling);
            }
            LifecycleOp::SetBuyerExposureCeiling {
                asset_idx,
                ceiling,
                authorized,
            } => {
                let a = &assets[(*asset_idx as usize) % 2];
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "set_buyer_exposure_ceiling",
                            args: (a.clone(), *ceiling).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_set_buyer_exposure_ceiling(a, ceiling);
            }
            LifecycleOp::SetSellerExposureCeiling {
                asset_idx,
                ceiling,
                authorized,
            } => {
                let a = &assets[(*asset_idx as usize) % 2];
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "set_seller_exposure_ceiling",
                            args: (a.clone(), *ceiling).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_set_seller_exposure_ceiling(a, ceiling);
            }
            LifecycleOp::SetMaxBuyerOpenSessions { limit, authorized } => {
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "set_max_buyer_open_sessions",
                            args: (*limit,).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_set_max_buyer_open_sessions(limit);
            }
            LifecycleOp::SetMaxSellerOpenSessions { limit, authorized } => {
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
                let _ = client
                    .mock_auths(&[MockAuth {
                        address: &caller,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "set_max_seller_open_sessions",
                            args: (*limit,).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_set_max_seller_open_sessions(limit);
            }
            LifecycleOp::ActivateAsset {
                asset_idx,
                authorized,
            } => {
                let a = &assets[(*asset_idx as usize) % 2];
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
                let policy = AssetPolicy {
                    asset: a.clone(),
                    max_session_amount: INITIAL_CAP,
                    min_session_amount: 1,
                    max_asset_exposure: INITIAL_MINT,
                    max_buyer_exposure: INITIAL_MINT,
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
            LifecycleOp::DeprecateAsset {
                asset_idx,
                authorized,
            } => {
                let a = &assets[(*asset_idx as usize) % 2];
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
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
            LifecycleOp::RemoveAsset {
                asset_idx,
                authorized,
            } => {
                let a = &assets[(*asset_idx as usize) % 2];
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
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
            LifecycleOp::ProposeAdmin {
                pending_idx: _,
                duration,
                authorized,
            } => {
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
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
            LifecycleOp::AcceptAdmin {
                caller_idx: _,
                authorized,
            } => {
                let caller = if *authorized {
                    pending_admin.clone()
                } else {
                    attacker.clone()
                };
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
            LifecycleOp::CancelAdminRotation { authorized } => {
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
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
            LifecycleOp::PauseCreation { authorized } => {
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
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
            LifecycleOp::ResumeCreation { authorized } => {
                let caller = if *authorized {
                    current_admin.clone()
                } else {
                    attacker.clone()
                };
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
            LifecycleOp::AdvanceLedger { delta } => {
                current_ledger = current_ledger.saturating_add(*delta);
                env.ledger().set_sequence_number(current_ledger);
            }
        }

        // Global invariant check after every operation:
        for asset in &assets {
            let tc = token::Client::new(&env, asset);
            let mut total_balance: i128 = tc.balance(&contract_id);
            for b in &buyers {
                total_balance = total_balance
                    .checked_add(tc.balance(b))
                    .expect("no overflow");
            }
            for s in &sellers {
                total_balance = total_balance
                    .checked_add(tc.balance(s))
                    .expect("no overflow");
            }
            total_balance = total_balance
                .checked_add(tc.balance(&attacker))
                .expect("no overflow");

            // Total funds conserved:
            let expected_total = INITIAL_MINT * (buyers.len() as i128);
            assert_eq!(
                total_balance, expected_total,
                "Funds conservation violated for asset {asset:?}"
            );

            // Escrow liability check:
            if client.try_get_configuration().is_ok() {
                let liability = client.get_escrow_liability(asset);
                assert!(liability >= 0, "Escrow liability cannot be negative");
                assert!(
                    liability <= tc.balance(&contract_id),
                    "Escrow liability cannot exceed contract token balance"
                );
            }
        }
    }
}

/// Fuzz target entrypoint for arbitrary lifecycle sequence fuzzing.
pub fn lifecycle(data: &[u8]) {
    let mut gen = LifecycleGenerator::from_bytes(data);
    let ops = gen.generate(16);
    let mut seed = 0u64;
    for chunk in data.chunks(8) {
        let mut buf = [0u8; 8];
        buf[..chunk.len()].copy_from_slice(chunk);
        seed ^= u64::from_le_bytes(buf);
    }
    run_lifecycle_sequence(seed, &ops);
}
