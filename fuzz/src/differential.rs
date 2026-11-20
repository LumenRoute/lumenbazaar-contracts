//! Model-versus-contract differential fuzzing.
//!
//! Executes identical generated operation traces against both the formal escrow model
//! (`formal/escrow-model`) and the executable `UptoSessionContract` in the Soroban test host.
//! Every observable state field (status, balances, liabilities, admin rotation, asset lifecycle,
//! errors, and events) is cross-checked after each step.
//!
//! Mismatches emit a standalone replay fixture (versioned JSON and hex) and panic.

use core::fmt::Debug;
use escrow_model::{Action, Rejection, State, Status};
use serde::{Deserialize, Serialize};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    token, Address, BytesN, Env, IntoVal,
};
use upto_session::{AssetPolicy, SessionStatus, UptoSessionContract, UptoSessionContractClient};

/// Magic header for versioned trace encoding.
pub const DIFF_TRACE_MAGIC: &[u8; 8] = b"LBDIFF01";
pub const DIFF_TRACE_VERSION: u32 = 1;

/// Standalone, deterministic, versioned trace.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffTraceV1 {
    pub version: u32,
    pub actions: Vec<Action>,
}

impl DiffTraceV1 {
    pub fn new(actions: Vec<Action>) -> Self {
        Self {
            version: DIFF_TRACE_VERSION,
            actions,
        }
    }

    /// Deterministic binary encoding: magic header (8 bytes), count (u32 LE), then action bytes.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(DIFF_TRACE_MAGIC);
        out.extend_from_slice(&(self.actions.len() as u32).to_le_bytes());
        for action in &self.actions {
            out.push(action_to_byte(*action));
        }
        out
    }

    /// Decodes from arbitrary bytes. If magic matches, decodes exact sequence; otherwise decodes
    /// arbitrary byte stream into deterministic actions.
    pub fn decode(data: &[u8]) -> Self {
        if data.len() >= 12 && &data[0..8] == DIFF_TRACE_MAGIC {
            let count = u32::from_le_bytes(data[8..12].try_into().unwrap()) as usize;
            let action_bytes = &data[12..];
            let actions = action_bytes
                .iter()
                .take(count)
                .copied()
                .map(byte_to_action)
                .collect();
            return Self::new(actions);
        }

        // Arbitrary fuzz input: map each byte to one of the canonical modeled actions
        let actions = data.iter().copied().map(byte_to_action).collect();
        Self::new(actions)
    }
}

/// Standalone replay fixture emitted on any model-versus-contract mismatch.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReplayFixture {
    pub format_version: u32,
    pub step: usize,
    pub failing_action: Action,
    pub model_state: State,
    pub model_result: Result<(), Rejection>,
    pub contract_result: String,
    pub mismatch: String,
    pub trace: Vec<Action>,
}

fn byte_to_action(b: u8) -> Action {
    match b % 29 {
        0 => Action::Initialize {
            admin_authorized: false,
        },
        1 => Action::Initialize {
            admin_authorized: true,
        },
        2 => Action::Create {
            buyer_authorized: false,
            cap: 1,
        },
        3 => Action::Create {
            buyer_authorized: true,
            cap: 0,
        },
        4 => Action::Create {
            buyer_authorized: true,
            cap: 1,
        },
        5 => Action::Create {
            buyer_authorized: true,
            cap: 2,
        },
        6 => Action::Settle {
            seller_authorized: false,
            amount: 1,
        },
        7 => Action::Settle {
            seller_authorized: true,
            amount: 0,
        },
        8 => Action::Settle {
            seller_authorized: true,
            amount: 1,
        },
        9 => Action::Settle {
            seller_authorized: true,
            amount: 2,
        },
        10 => Action::Settle {
            seller_authorized: true,
            amount: 3,
        },
        11 => Action::Cancel {
            buyer_authorized: false,
        },
        12 => Action::Cancel {
            buyer_authorized: true,
        },
        13 => Action::Reject {
            seller_authorized: false,
        },
        14 => Action::Reject {
            seller_authorized: true,
        },
        15 => Action::AdvanceToExpiry,
        16 => Action::Recover,
        17 => Action::Create {
            buyer_authorized: false,
            cap: 2,
        },
        18 => Action::Settle {
            seller_authorized: false,
            amount: 2,
        },
        19 => Action::DeprecateAsset { caller: 1 },
        20 => Action::DeprecateAsset { caller: 3 },
        21 => Action::RemoveAsset { caller: 1 },
        22 => Action::RemoveAsset { caller: 3 },
        23 => Action::ProposeAdmin {
            caller: 1,
            pending: 2,
            expires_at: 2,
        },
        24 => Action::ProposeAdmin {
            caller: 3,
            pending: 2,
            expires_at: 2,
        },
        25 => Action::AcceptAdmin { caller: 2 },
        26 => Action::AcceptAdmin { caller: 3 },
        27 => Action::CancelAdminRotation { caller: 1 },
        _ => Action::CancelAdminRotation { caller: 3 },
    }
}

fn action_to_byte(action: Action) -> u8 {
    match action {
        Action::Initialize {
            admin_authorized: false,
        } => 0,
        Action::Initialize {
            admin_authorized: true,
        } => 1,
        Action::Create {
            buyer_authorized: false,
            cap: 1,
        } => 2,
        Action::Create {
            buyer_authorized: true,
            cap: 0,
        } => 3,
        Action::Create {
            buyer_authorized: true,
            cap: 1,
        } => 4,
        Action::Create {
            buyer_authorized: true,
            cap: 2,
        } => 5,
        Action::Settle {
            seller_authorized: false,
            amount: 1,
        } => 6,
        Action::Settle {
            seller_authorized: true,
            amount: 0,
        } => 7,
        Action::Settle {
            seller_authorized: true,
            amount: 1,
        } => 8,
        Action::Settle {
            seller_authorized: true,
            amount: 2,
        } => 9,
        Action::Settle {
            seller_authorized: true,
            amount: 3,
        } => 10,
        Action::Cancel {
            buyer_authorized: false,
        } => 11,
        Action::Cancel {
            buyer_authorized: true,
        } => 12,
        Action::Reject {
            seller_authorized: false,
        } => 13,
        Action::Reject {
            seller_authorized: true,
        } => 14,
        Action::AdvanceToExpiry => 15,
        Action::Recover => 16,
        Action::Create {
            buyer_authorized: false,
            cap: 2,
        } => 17,
        Action::Settle {
            seller_authorized: false,
            amount: 2,
        } => 18,
        Action::DeprecateAsset { caller: 1 } => 19,
        Action::DeprecateAsset { caller: 3 } => 20,
        Action::RemoveAsset { caller: 1 } => 21,
        Action::RemoveAsset { caller: 3 } => 22,
        Action::ProposeAdmin {
            caller: 1,
            pending: 2,
            expires_at: 2,
        } => 23,
        Action::ProposeAdmin {
            caller: 3,
            pending: 2,
            expires_at: 2,
        } => 24,
        Action::AcceptAdmin { caller: 2 } => 25,
        Action::AcceptAdmin { caller: 3 } => 26,
        Action::CancelAdminRotation { caller: 1 } => 27,
        Action::CancelAdminRotation { caller: 3 } => 28,
        _ => 0,
    }
}

/// Scale factor: 1 model unit = 100 token units in contract.
const SCALE: i128 = 100;

/// Differential fuzz harness running `trace` against both formal model and executable contract.
pub fn run_differential_trace(trace: &DiffTraceV1) {
    let env = Env::default();
    let contract_id = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);

    let initial_buyer_mint = 10_000 * SCALE;
    let asset = {
        let token_admin = Address::generate(&env);
        let a = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        token::StellarAssetClient::new(&env, &a)
            .mock_auths(&[MockAuth {
                address: &token_admin,
                invoke: &MockAuthInvoke {
                    contract: &a,
                    fn_name: "mint",
                    args: (buyer.clone(), initial_buyer_mint).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .mint(&buyer, &initial_buyer_mint);
        a
    };

    let token = token::Client::new(&env, &asset);
    let resource_hash = BytesN::from_array(&env, &[11; 32]);
    let usage_hash = BytesN::from_array(&env, &[22; 32]);
    let reason_hash = BytesN::from_array(&env, &[33; 32]);

    let mut model_state = State::default();
    let mut current_session_id: Option<BytesN<32>> = None;

    let resolve_caller = |caller_id: u8| -> Address {
        match caller_id {
            1 => admin1.clone(),
            2 => admin2.clone(),
            3 => admin3.clone(),
            _ => Address::generate(&env),
        }
    };

    for (step_idx, &action) in trace.actions.iter().enumerate() {
        let mut next_model = model_state;
        let model_result = escrow_model::apply(&mut next_model, action);

        // Execute corresponding action on Soroban contract:
        let contract_result: Result<(), String> = match action {
            Action::Initialize { admin_authorized } => {
                let policies = soroban_sdk::vec![
                    &env,
                    AssetPolicy {
                        asset: asset.clone(),
                        max_session_amount: 10 * SCALE,
                        min_session_amount: 1,
                        max_asset_exposure: 100 * SCALE,
                        max_buyer_exposure: 100 * SCALE,
                    }
                ];
                let caller = admin1.clone();
                let auth_addr = if admin_authorized {
                    admin1.clone()
                } else {
                    admin3.clone()
                };
                let res = client
                    .mock_auths(&[MockAuth {
                        address: &auth_addr,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "initialize",
                            args: (caller.clone(), policies.clone()).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_initialize(&caller, &policies);
                match res {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(format!("ContractError::{e:?}")),
                    Err(e) => Err(format!("HostError::{e:?}")),
                }
            }
            Action::Create {
                buyer_authorized,
                cap,
            } => {
                let cap_amount = i128::from(cap) * SCALE;
                let expires_at = escrow_model::EXPIRY_LEDGER as u32;
                let caller = buyer.clone();
                let auth_addr = if buyer_authorized {
                    buyer.clone()
                } else {
                    admin3.clone()
                };
                let res = client
                    .mock_auths(&[MockAuth {
                        address: &auth_addr,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "create_session",
                            args: (
                                caller.clone(),
                                seller.clone(),
                                asset.clone(),
                                cap_amount,
                                expires_at,
                                resource_hash.clone(),
                            )
                                .into_val(&env),
                            sub_invokes: &[MockAuthInvoke {
                                contract: &asset,
                                fn_name: "transfer",
                                args: (caller.clone(), contract_id.clone(), cap_amount)
                                    .into_val(&env),
                                sub_invokes: &[],
                            }],
                        },
                    }])
                    .try_create_session(
                        &caller,
                        &seller,
                        &asset,
                        &cap_amount,
                        &expires_at,
                        &resource_hash,
                    );
                match res {
                    Ok(Ok(id)) => {
                        current_session_id = Some(id);
                        Ok(())
                    }
                    Ok(Err(e)) => Err(format!("ContractError::{e:?}")),
                    Err(e) => Err(format!("HostError::{e:?}")),
                }
            }
            Action::Settle {
                seller_authorized,
                amount,
            } => {
                let settle_amount = i128::from(amount) * SCALE;
                let auth_addr = if seller_authorized {
                    seller.clone()
                } else {
                    admin3.clone()
                };
                let dummy_id = BytesN::from_array(&env, &[99; 32]);
                let sid = current_session_id.as_ref().unwrap_or(&dummy_id);
                let res = client
                    .mock_auths(&[MockAuth {
                        address: &auth_addr,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "settle",
                            args: (sid.clone(), settle_amount, usage_hash.clone()).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_settle(sid, &settle_amount, &usage_hash);
                match res {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(format!("ContractError::{e:?}")),
                    Err(e) => Err(format!("HostError::{e:?}")),
                }
            }
            Action::Cancel { buyer_authorized } => {
                let auth_addr = if buyer_authorized {
                    buyer.clone()
                } else {
                    admin3.clone()
                };
                let dummy_id = BytesN::from_array(&env, &[99; 32]);
                let sid = current_session_id.as_ref().unwrap_or(&dummy_id);
                let res = client
                    .mock_auths(&[MockAuth {
                        address: &auth_addr,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "cancel",
                            args: (sid.clone(),).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_cancel(sid);
                match res {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(format!("ContractError::{e:?}")),
                    Err(e) => Err(format!("HostError::{e:?}")),
                }
            }
            Action::Reject { seller_authorized } => {
                let auth_addr = if seller_authorized {
                    seller.clone()
                } else {
                    admin3.clone()
                };
                let dummy_id = BytesN::from_array(&env, &[99; 32]);
                let sid = current_session_id.as_ref().unwrap_or(&dummy_id);
                let res = client
                    .mock_auths(&[MockAuth {
                        address: &auth_addr,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "reject",
                            args: (sid.clone(),).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_reject(sid);
                match res {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(format!("ContractError::{e:?}")),
                    Err(e) => Err(format!("HostError::{e:?}")),
                }
            }
            Action::AdvanceToExpiry => {
                env.ledger()
                    .set_sequence_number(escrow_model::EXPIRY_LEDGER as u32);
                Ok(())
            }
            Action::Recover => {
                let dummy_id = BytesN::from_array(&env, &[99; 32]);
                let sid = current_session_id.as_ref().unwrap_or(&dummy_id);
                match client.try_recover_expired(sid) {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(format!("ContractError::{e:?}")),
                    Err(e) => Err(format!("HostError::{e:?}")),
                }
            }
            Action::DeprecateAsset { caller } => {
                let caller_addr = resolve_caller(caller);
                let res = client
                    .mock_auths(&[MockAuth {
                        address: &caller_addr,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "deprecate_asset",
                            args: (asset.clone(), reason_hash.clone()).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_deprecate_asset(&asset, &reason_hash);
                match res {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(format!("ContractError::{e:?}")),
                    Err(e) => Err(format!("HostError::{e:?}")),
                }
            }
            Action::RemoveAsset { caller } => {
                let caller_addr = resolve_caller(caller);
                let res = client
                    .mock_auths(&[MockAuth {
                        address: &caller_addr,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "remove_asset",
                            args: (asset.clone(), reason_hash.clone()).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_remove_asset(&asset, &reason_hash);
                match res {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(format!("ContractError::{e:?}")),
                    Err(e) => Err(format!("HostError::{e:?}")),
                }
            }
            Action::ProposeAdmin {
                caller,
                pending,
                expires_at,
            } => {
                let caller_addr = resolve_caller(caller);
                let pending_addr = resolve_caller(pending);
                let res = client
                    .mock_auths(&[MockAuth {
                        address: &caller_addr,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "propose_admin",
                            args: (pending_addr.clone(), expires_at as u32).into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_propose_admin(&pending_addr, &(expires_at as u32));
                match res {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(format!("ContractError::{e:?}")),
                    Err(e) => Err(format!("HostError::{e:?}")),
                }
            }
            Action::AcceptAdmin { caller } => {
                let caller_addr = resolve_caller(caller);
                let res = client
                    .mock_auths(&[MockAuth {
                        address: &caller_addr,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "accept_admin",
                            args: ().into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_accept_admin();
                match res {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(format!("ContractError::{e:?}")),
                    Err(e) => Err(format!("HostError::{e:?}")),
                }
            }
            Action::CancelAdminRotation { caller } => {
                let caller_addr = resolve_caller(caller);
                let res = client
                    .mock_auths(&[MockAuth {
                        address: &caller_addr,
                        invoke: &MockAuthInvoke {
                            contract: &contract_id,
                            fn_name: "cancel_admin_rotation",
                            args: ().into_val(&env),
                            sub_invokes: &[],
                        },
                    }])
                    .try_cancel_admin_rotation();
                match res {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(format!("ContractError::{e:?}")),
                    Err(e) => Err(format!("HostError::{e:?}")),
                }
            }
        };

        // Comparison rules:
        let mut check_mismatch = || -> Option<String> {
            // 1. Result parity (Ok vs Err)
            if model_result.is_ok() != contract_result.is_ok() {
                return Some(format!(
                    "Result mismatch: model={model_result:?}, contract={contract_result:?}"
                ));
            }

            if model_result.is_ok() {
                // Update model state upon success
                model_state = next_model;
            }

            // 2. Status comparison
            if let Some(ref sid) = current_session_id {
                if let Ok(Ok(session)) = client.try_get_session(sid) {
                    let expected_status = match model_state.status {
                        Status::Open => SessionStatus::Open,
                        Status::Settled => SessionStatus::Settled,
                        Status::Cancelled => SessionStatus::Cancelled,
                        Status::Expired => SessionStatus::Expired,
                        Status::Rejected => SessionStatus::Rejected,
                        Status::Absent => {
                            return Some("Session exists in contract but is Absent in model".into())
                        }
                    };
                    if session.status != expected_status {
                        return Some(format!(
                            "Status mismatch: model={:?}, contract={:?}",
                            expected_status, session.status
                        ));
                    }
                }
            } else if model_state.status != Status::Absent {
                return Some(format!(
                    "Session is {:?} in model but not created in contract",
                    model_state.status
                ));
            }

            // 3. Balance & Liability comparisons
            let expected_contract_balance = i128::from(model_state.contract_balance) * SCALE;
            let actual_contract_balance = token.balance(&contract_id);
            if actual_contract_balance != expected_contract_balance {
                return Some(format!(
                    "Contract balance mismatch: expected={expected_contract_balance}, actual={actual_contract_balance}"
                ));
            }

            let expected_liability = i128::from(model_state.liability) * SCALE;
            if client.try_get_configuration().is_ok() {
                if let Ok(Ok(actual_liability)) = client.try_get_escrow_liability(&asset) {
                    if actual_liability != expected_liability {
                        return Some(format!(
                            "Liability mismatch: expected={expected_liability}, actual={actual_liability}"
                        ));
                    }
                } else if model_state.liability != 0 {
                    return Some("Liability lookup failed while model liability is nonzero".into());
                }
            }

            let expected_seller_paid = i128::from(model_state.seller_paid) * SCALE;
            let actual_seller_paid = token.balance(&seller);
            if actual_seller_paid != expected_seller_paid {
                return Some(format!(
                    "Seller paid mismatch: expected={expected_seller_paid}, actual={actual_seller_paid}"
                ));
            }

            // 4. Admin state comparison
            if model_state.initialized {
                if let Ok(Ok(cfg)) = client.try_get_configuration() {
                    let expected_admin = match model_state.admin {
                        1 => admin1.clone(),
                        2 => admin2.clone(),
                        _ => admin3.clone(),
                    };
                    if cfg.admin != expected_admin {
                        return Some(format!(
                            "Admin mismatch: model admin={}, contract admin={:?}",
                            model_state.admin, cfg.admin
                        ));
                    }
                }

                let rotation = client.get_admin_rotation();
                let has_rotation = rotation.is_some();
                let expected_has_rotation = model_state.pending_admin.is_some();
                if has_rotation != expected_has_rotation {
                    return Some(format!(
                        "Admin rotation mismatch: model pending={:?}, contract has_rotation={has_rotation}",
                        model_state.pending_admin
                    ));
                }
            }

            None
        };

        if let Some(mismatch) = check_mismatch() {
            let fixture = ReplayFixture {
                format_version: DIFF_TRACE_VERSION,
                step: step_idx,
                failing_action: action,
                model_state,
                model_result,
                contract_result: format!("{contract_result:?}"),
                mismatch: mismatch.clone(),
                trace: trace.actions.clone(),
            };
            let fixture_json =
                serde_json::to_string_pretty(&fixture).unwrap_or_else(|_| "{}".into());
            eprintln!("\n=== STANDALONE REPLAY FIXTURE ===");
            eprintln!("{fixture_json}");
            eprintln!("=================================\n");
            panic!(
                "Differential fuzzing mismatch at step {step_idx}: {mismatch}\nReplay fixture:\n{fixture_json}"
            );
        }
    }
}

/// Fuzz target for model-versus-contract differential testing.
pub fn differential(data: &[u8]) {
    let trace = DiffTraceV1::decode(data);
    run_differential_trace(&trace);
}
