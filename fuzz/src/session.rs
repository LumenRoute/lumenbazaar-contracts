//! `create` and `settle` targets against the real `upto-session` contract and a Stellar asset
//! contract. Byte layouts are documented in `fuzz/README.md`.

use crate::input::{account_address, contract_address, Input};
use crate::{defined, DEFAULT_LEDGER, ENTRY_TTL, MAX_LEDGER};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec, Address, Bytes, BytesN, Env, IntoVal, Symbol, Val, Vec,
};
use upto_session::{
    storage::{self, DataKey},
    validation::MAX_SESSION_DURATION_LEDGERS,
    AssetPolicy, BatchRecoveryStatus, Session, SessionStatus, UptoSessionContract,
    UptoSessionContractClient,
};

const SESSION_LENGTH: u32 = 500;

struct Escrow {
    env: Env,
    contract: Address,
    buyer: Address,
    seller: Address,
    asset: Address,
}

/// Balances, liability, and next sequence: everything a rejected call must leave unchanged.
#[derive(Debug, PartialEq)]
struct Observed {
    buyer: i128,
    seller: i128,
    escrow: i128,
    liability: i128,
    sequence: u64,
}

impl Escrow {
    /// The buyer always holds `i128::MAX`, so a token transfer never fails for lack of funds.
    /// `fund_seller` lets the seller act as a payer too; settlement targets leave the seller empty
    /// so payouts cannot overflow its balance.
    fn new(ledger: u32, fund_seller: bool) -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().set_sequence_number(ledger);
        // Storage expiry is covered by the upto-session lifecycle tests, not here. Every entry
        // outlives the ledgers these targets reach, so a TTL lapse is never mistaken for a
        // validation failure.
        env.ledger().set_min_persistent_entry_ttl(ENTRY_TTL);
        let contract = env.register(UptoSessionContract, ());
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let asset = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();
        let mint = token::StellarAssetClient::new(&env, &asset);
        mint.mint(&buyer, &i128::MAX);
        if fund_seller {
            mint.mint(&seller, &i128::MAX);
        }
        UptoSessionContractClient::new(&env, &contract).initialize(
            &admin,
            &vec![
                &env,
                AssetPolicy {
                    asset: asset.clone(),
                    max_session_amount: i128::MAX,
                    min_session_amount: 1,
                    max_asset_exposure: i128::MAX,
                    max_buyer_exposure: i128::MAX,
                },
            ],
        );
        Self {
            env,
            contract,
            buyer,
            seller,
            asset,
        }
    }

    fn client(&self) -> UptoSessionContractClient<'_> {
        UptoSessionContractClient::new(&self.env, &self.contract)
    }

    fn observe(&self) -> Observed {
        let token = token::Client::new(&self.env, &self.asset);
        Observed {
            buyer: token.balance(&self.buyer),
            seller: token.balance(&self.seller),
            escrow: token.balance(&self.contract),
            liability: self.client().get_escrow_liability(&self.asset),
            sequence: self.env.as_contract(&self.contract, || {
                storage::read_next_session_sequence(&self.env)
            }),
        }
    }

    fn session(&self, id: &BytesN<32>) -> Option<Session> {
        self.client().try_get_session(id).ok().and_then(Result::ok)
    }

    /// Calls `function` with raw arguments, bypassing the typed client. The call must not succeed.
    fn invoke_raw_rejected(&self, function: &str, args: Vec<Val>) {
        let result = self.env.try_invoke_contract::<Val, soroban_sdk::Error>(
            &self.contract,
            &Symbol::new(&self.env, function),
            args,
        );
        assert!(
            !matches!(result, Ok(Ok(_))),
            "{function} accepted a wrong-length hash"
        );
    }
}

/// Bytes of a length that is never 32.
fn wrong_length_bytes(env: &Env, selector: u8) -> Bytes {
    let len = match (selector % 64) as usize {
        32 => 33,
        len => len,
    };
    Bytes::from_slice(env, &[0x5a; 64][..len])
}

/// Session creation with arbitrary parties, amounts, expiries, and resource hashes.
pub fn create(data: &[u8]) {
    let input = Input::new(data);
    let ledger = match input.u8(0) % 4 {
        0 => DEFAULT_LEDGER,
        1 => input.u32(1) % MAX_LEDGER,
        2 => 0,
        _ => 1,
    };
    let h = Escrow::new(ledger, true);
    let env = &h.env;
    let raw: [u8; 32] = input.array(31);
    let buyer = match input.u8(5) % 3 {
        1 => h.seller.clone(),
        _ => h.buyer.clone(),
    };
    let seller = match input.u8(6) % 6 {
        0 => h.seller.clone(),
        1 => h.buyer.clone(),
        2 => account_address(env, raw),
        3 => contract_address(env, raw),
        4 => h.contract.clone(),
        _ => h.asset.clone(),
    };
    let asset = match input.u8(7) % 5 {
        0 => h.asset.clone(),
        1 => buyer.clone(),
        2 => seller.clone(),
        3 => contract_address(env, raw),
        _ => h.contract.clone(),
    };
    let amount = input.amount(8, 1_000);
    let expires = match input.u8(25) % 8 {
        0 => ledger + 100,
        1 => ledger,
        2 => ledger.wrapping_sub(1),
        3 => ledger + MAX_SESSION_DURATION_LEDGERS,
        4 => ledger + MAX_SESSION_DURATION_LEDGERS + 1,
        5 => input.u32(26),
        6 => u32::MAX,
        _ => 0,
    };
    let resource = input.hash(env, 30, 7);
    let idempotency_key = input.hash(env, 64, 9);
    let before = h.observe();

    if input.u8(63) % 2 == 1 {
        let args = vec![
            env,
            buyer.into_val(env),
            seller.into_val(env),
            asset.into_val(env),
            amount.into_val(env),
            expires.into_val(env),
            wrong_length_bytes(env, raw[0]).into_val(env),
            idempotency_key.into_val(env),
        ];
        h.invoke_raw_rejected("create_session", args);
        assert_eq!(h.observe(), before, "rejected create changed state");
        return;
    }

    let valid = buyer != seller
        && asset != buyer
        && asset != seller
        && amount > 0
        && expires > ledger
        && expires - ledger <= MAX_SESSION_DURATION_LEDGERS
        && resource != BytesN::from_array(env, &[0; 32])
        && asset == h.asset;
    let result = defined(h.client().try_create_session(
        &buyer,
        &seller,
        &asset,
        &amount,
        &expires,
        &resource,
        &idempotency_key,
    ));
    match (result, valid) {
        (Ok(id), true) => {
            let session = h.session(&id).expect("created session is readable");
            assert_eq!(
                (session.buyer, session.seller, session.asset),
                (buyer.clone(), seller, asset)
            );
            assert_eq!(
                (session.max_amount, session.escrowed_amount),
                (amount, amount)
            );
            assert_eq!(session.expires_at_ledger, expires);
            assert_eq!(session.resource_hash, resource);
            assert_eq!(session.status, SessionStatus::Open);
            let after = h.observe();
            assert_eq!(after.liability, before.liability + amount);
            assert_eq!(after.escrow, before.escrow + amount);
            assert_eq!(after.sequence, before.sequence + 1);
            let paid = if buyer == h.buyer {
                before.buyer - after.buyer
            } else {
                before.seller - after.seller
            };
            assert_eq!(paid, amount);
        }
        (Ok(_), false) => panic!("validation bypass: create_session accepted invalid input"),
        (Err(error), true) => panic!("valid create_session rejected with {error:?}"),
        (Err(_), false) => assert_eq!(h.observe(), before, "rejected create changed state"),
    }
}

/// Settlement of open, finalized, missing, and unknown sessions with arbitrary amounts, usage
/// hashes, and ledgers around expiry.
pub fn settle(data: &[u8]) {
    let input = Input::new(data);
    let cap = match input.u8(0) % 4 {
        0 => 1_000,
        1 => 1,
        2 => i128::MAX,
        _ => input.i128(1).rem_euclid(1_000_000_000_000) + 1,
    };
    let h = Escrow::new(DEFAULT_LEDGER, false);
    let env = &h.env;
    let client = h.client();
    let expiry = DEFAULT_LEDGER + SESSION_LENGTH;
    let id = client.create_session(
        &h.buyer,
        &h.seller,
        &h.asset,
        &cap,
        &expiry,
        &BytesN::from_array(env, &[7; 32]),
        &BytesN::from_array(env, &[9; 32]),
    );
    let state = input.u8(17) % 5;
    match state {
        1 => client.settle(&id, &1, &BytesN::from_array(env, &[8; 32])),
        2 => client.cancel(&id),
        3 => {
            env.ledger().set_sequence_number(expiry);
            client.recover_expired(&id);
        }
        4 => env.as_contract(&h.contract, || {
            env.storage()
                .persistent()
                .remove(&DataKey::Session(id.clone()))
        }),
        _ => {}
    }

    let raw: [u8; 32] = input.array(19);
    let target = match input.u8(18) % 5 {
        1 => BytesN::from_array(env, &[0; 32]),
        2 => BytesN::from_array(env, &[0xFF; 32]),
        3 => BytesN::from_array(env, &raw),
        4 => {
            let mut flipped = id.to_array();
            flipped[31] ^= 1;
            BytesN::from_array(env, &flipped)
        }
        _ => id.clone(),
    };
    let ledger = match input.u8(51) % 5 {
        0 => DEFAULT_LEDGER + 1,
        1 => expiry - 1,
        2 => expiry,
        3 => expiry + 1,
        _ => DEFAULT_LEDGER + input.u32(52) % (2 * MAX_SESSION_DURATION_LEDGERS),
    };
    env.ledger().set_sequence_number(ledger);
    let amount = input.amount(56, cap.min(500));
    let usage = input.hash(env, 73, 8);
    let before = h.observe();
    let session_before = h.session(&id);

    let malformed = input.u8(106) % 3;
    if malformed != 0 {
        let (session_arg, usage_arg): (Val, Val) = if malformed == 1 {
            (
                wrong_length_bytes(env, raw[0]).into_val(env),
                usage.into_val(env),
            )
        } else {
            (
                target.into_val(env),
                wrong_length_bytes(env, raw[0]).into_val(env),
            )
        };
        let args = vec![env, session_arg, amount.into_val(env), usage_arg];
        h.invoke_raw_rejected("settle", args);
        assert_eq!(h.observe(), before, "rejected settle changed state");
        assert_eq!(h.session(&id), session_before);
        return;
    }

    let valid = state == 0
        && target == id
        && amount > 0
        && amount <= cap
        && ledger < expiry
        && usage != BytesN::from_array(env, &[0; 32]);
    let result = defined(client.try_settle(&target, &amount, &usage));
    match (result, valid) {
        (Ok(()), true) => {
            let after = h.observe();
            assert_eq!(after.seller, before.seller + amount);
            assert_eq!(after.buyer, before.buyer + (cap - amount));
            assert_eq!(after.escrow, before.escrow - cap);
            assert_eq!(after.liability, before.liability - cap);
            let session = h.session(&id).expect("settled session is readable");
            assert_eq!(session.status, SessionStatus::Settled);
            assert_eq!(session.settled_amount, amount);
            assert_eq!(session.usage_hash, Some(usage));
        }
        (Ok(()), false) => panic!("validation bypass: settle accepted invalid input"),
        (Err(error), true) => panic!("valid settle rejected with {error:?}"),
        (Err(_), false) => {
            assert_eq!(h.observe(), before, "rejected settle changed state");
            assert_eq!(
                h.session(&id),
                session_before,
                "rejected settle changed session"
            );
        }
    }
}

/// Multi-buyer, multi-seller, multi-asset transition sequence target verifying aggregate escrow
/// liability conservation (#178) and refund destination pinning (#177) across all refund paths.
pub fn transitions(data: &[u8]) {
    let input = Input::new(data);
    let env = Env::default();
    env.ledger().set_sequence_number(DEFAULT_LEDGER);
    env.ledger().set_min_persistent_entry_ttl(ENTRY_TTL);

    let contract = env.register(UptoSessionContract, ());
    let client = UptoSessionContractClient::new(&env, &contract);
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let buyers = [Address::generate(&env), Address::generate(&env)];
    let sellers = [Address::generate(&env), Address::generate(&env)];

    const INITIAL_MINT: i128 = 10_000_000;
    let mut assets = std::vec::Vec::with_capacity(2);
    for _ in 0..2 {
        let token_admin = Address::generate(&env);
        let asset = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let mint = token::StellarAssetClient::new(&env, &asset);
        env.mock_all_auths_allowing_non_root_auth();
        for buyer in &buyers {
            mint.mint(buyer, &INITIAL_MINT);
        }
        assets.push(asset);
    }

    client.initialize(
        &admin,
        &vec![
            &env,
            AssetPolicy {
                asset: assets[0].clone(),
                max_session_amount: i128::MAX,
                min_session_amount: 1,
                max_asset_exposure: i128::MAX,
                max_buyer_exposure: i128::MAX,
            },
            AssetPolicy {
                asset: assets[1].clone(),
                max_session_amount: i128::MAX,
                min_session_amount: 1,
                max_asset_exposure: i128::MAX,
                max_buyer_exposure: i128::MAX,
            },
        ],
    );

    struct Tracked {
        id: BytesN<32>,
        buyer: usize,
        seller: usize,
        asset: usize,
        cap: i128,
        escrowed: i128,
        open: bool,
    }

    let mut sessions: std::vec::Vec<Tracked> = std::vec::Vec::new();
    let mut deposited = [0_i128; 2];
    let mut settled = [0_i128; 2];
    let mut refunded = [0_i128; 2];
    let mut ledger = DEFAULT_LEDGER;

    let steps = (usize::from(input.u8(0)) % 12).max(1);
    for step in 0..steps {
        let base = 1 + step * 5;
        let op = input.u8(base) % 9;
        let b_idx = usize::from(input.u8(base + 1) % 2);
        let s_idx = usize::from(input.u8(base + 2) % 2);
        let a_idx = usize::from(input.u8(base + 3) % 2);
        let arg = input.u8(base + 4);

        let before_admin: [i128; 2] = [
            token::Client::new(&env, &assets[0]).balance(&admin),
            token::Client::new(&env, &assets[1]).balance(&admin),
        ];
        let before_attacker: [i128; 2] = [
            token::Client::new(&env, &assets[0]).balance(&attacker),
            token::Client::new(&env, &assets[1]).balance(&attacker),
        ];
        let before_sellers: [[i128; 2]; 2] = [
            [
                token::Client::new(&env, &assets[0]).balance(&sellers[0]),
                token::Client::new(&env, &assets[1]).balance(&sellers[0]),
            ],
            [
                token::Client::new(&env, &assets[0]).balance(&sellers[1]),
                token::Client::new(&env, &assets[1]).balance(&sellers[1]),
            ],
        ];

        let mut expected_seller_payout: Option<(usize, usize, i128)> = None;

        match op {
            0 | 1 => {
                let cap = i128::from(arg % 100) * 10 + 10;
                let expiry = ledger + u32::from(arg % 30) + 5;
                let mut rbytes = [0u8; 32];
                rbytes[0] = (step as u8).wrapping_add(1);
                rbytes[1] = arg.wrapping_add(1);
                let rhash = BytesN::from_array(&env, &rbytes);
                let mut kbytes = [0u8; 32];
                kbytes[0] = 0xAA;
                kbytes[1] = step as u8;
                let ikey = BytesN::from_array(&env, &kbytes);
                if let Ok(id) = defined(client.try_create_session(
                    &buyers[b_idx],
                    &sellers[s_idx],
                    &assets[a_idx],
                    &cap,
                    &expiry,
                    &rhash,
                    &ikey,
                )) {
                    deposited[a_idx] += cap;
                    sessions.push(Tracked {
                        id,
                        buyer: b_idx,
                        seller: s_idx,
                        asset: a_idx,
                        cap,
                        escrowed: cap,
                        open: true,
                    });
                }
            }
            2 if !sessions.is_empty() => {
                let idx = usize::from(arg) % sessions.len();
                let amount = (sessions[idx].cap / 2).max(1);
                let usage = BytesN::from_array(&env, &[(step as u8).wrapping_add(0x40); 32]);
                if defined(client.try_settle(&sessions[idx].id, &amount, &usage)).is_ok() {
                    let a = sessions[idx].asset;
                    let s = sessions[idx].seller;
                    let rem = sessions[idx].escrowed - amount;
                    settled[a] += amount;
                    refunded[a] += rem;
                    expected_seller_payout = Some((s, a, amount));
                    sessions[idx].escrowed = 0;
                    sessions[idx].open = false;
                }
            }
            3 if !sessions.is_empty() => {
                let idx = usize::from(arg) % sessions.len();
                let buyer_before = token::Client::new(&env, &assets[sessions[idx].asset])
                    .balance(&buyers[sessions[idx].buyer]);
                if defined(client.try_cancel(&sessions[idx].id)).is_ok() {
                    let a = sessions[idx].asset;
                    let b = sessions[idx].buyer;
                    let amt = sessions[idx].escrowed;
                    let buyer_after = token::Client::new(&env, &assets[a]).balance(&buyers[b]);
                    assert_eq!(
                        buyer_after - buyer_before,
                        amt,
                        "cancel refund not pinned to buyer"
                    );
                    refunded[a] += amt;
                    sessions[idx].escrowed = 0;
                    sessions[idx].open = false;
                }
            }
            4 if !sessions.is_empty() => {
                let idx = usize::from(arg) % sessions.len();
                let buyer_before = token::Client::new(&env, &assets[sessions[idx].asset])
                    .balance(&buyers[sessions[idx].buyer]);
                if defined(client.try_reject(&sessions[idx].id)).is_ok() {
                    let a = sessions[idx].asset;
                    let b = sessions[idx].buyer;
                    let amt = sessions[idx].escrowed;
                    let buyer_after = token::Client::new(&env, &assets[a]).balance(&buyers[b]);
                    assert_eq!(
                        buyer_after - buyer_before,
                        amt,
                        "reject refund not pinned to buyer"
                    );
                    refunded[a] += amt;
                    sessions[idx].escrowed = 0;
                    sessions[idx].open = false;
                }
            }
            5 if !sessions.is_empty() => {
                let idx = usize::from(arg) % sessions.len();
                let cur = sessions[idx].cap;
                if cur > 1 {
                    let new_cap = cur / 2;
                    let buyer_before = token::Client::new(&env, &assets[sessions[idx].asset])
                        .balance(&buyers[sessions[idx].buyer]);
                    if defined(client.try_reduce_session_cap(&sessions[idx].id, &new_cap)).is_ok() {
                        let a = sessions[idx].asset;
                        let b = sessions[idx].buyer;
                        let diff = cur - new_cap;
                        let buyer_after = token::Client::new(&env, &assets[a]).balance(&buyers[b]);
                        assert_eq!(
                            buyer_after - buyer_before,
                            diff,
                            "reduce_session_cap refund not pinned to buyer"
                        );
                        refunded[a] += diff;
                        sessions[idx].cap = new_cap;
                        sessions[idx].escrowed = new_cap;
                    }
                }
            }
            6 => {
                ledger += u32::from(arg % 40) + 1;
                env.ledger().set_sequence_number(ledger);
            }
            7 if !sessions.is_empty() => {
                let idx = usize::from(arg) % sessions.len();
                let buyer_before = token::Client::new(&env, &assets[sessions[idx].asset])
                    .balance(&buyers[sessions[idx].buyer]);
                if defined(client.try_recover_expired(&sessions[idx].id)).is_ok() {
                    let a = sessions[idx].asset;
                    let b = sessions[idx].buyer;
                    let amt = sessions[idx].escrowed;
                    let buyer_after = token::Client::new(&env, &assets[a]).balance(&buyers[b]);
                    assert_eq!(
                        buyer_after - buyer_before,
                        amt,
                        "recover_expired refund not pinned to buyer"
                    );
                    refunded[a] += amt;
                    sessions[idx].escrowed = 0;
                    sessions[idx].open = false;
                }
            }
            8 if !sessions.is_empty() => {
                let ia = usize::from(arg) % sessions.len();
                let ib = usize::from(arg.wrapping_add(1)) % sessions.len();
                let batch = vec![&env, sessions[ia].id.clone(), sessions[ib].id.clone()];
                let results = client.recover_expired_batch(&batch);
                for (pos, idx) in [ia, ib].into_iter().enumerate() {
                    if results.get(pos as u32).unwrap().status == BatchRecoveryStatus::Recovered {
                        let a = sessions[idx].asset;
                        let amt = sessions[idx].escrowed;
                        refunded[a] += amt;
                        sessions[idx].escrowed = 0;
                        sessions[idx].open = false;
                    }
                }
            }
            _ => {}
        }

        // Assert liability conservation and refund destination pinning after every step.
        for (a, asset) in assets.iter().enumerate() {
            let tok = token::Client::new(&env, asset);
            assert_eq!(
                tok.balance(&admin),
                before_admin[a],
                "admin received diverted funds"
            );
            assert_eq!(
                tok.balance(&attacker),
                before_attacker[a],
                "attacker received diverted funds"
            );
            for (s, seller) in sellers.iter().enumerate() {
                let expected_delta = match expected_seller_payout {
                    Some((ps, pa, amt)) if ps == s && pa == a => amt,
                    _ => 0,
                };
                assert_eq!(
                    tok.balance(seller) - before_sellers[s][a],
                    expected_delta,
                    "seller received unexpected funds on non-settlement path"
                );
            }

            let escrow_bal = tok.balance(&contract);
            let liability = client.get_escrow_liability(asset);
            let expected_open: i128 = sessions
                .iter()
                .filter(|s| s.asset == a && s.open)
                .map(|s| s.escrowed)
                .sum();
            assert_eq!(liability, expected_open, "aggregate liability mismatch");
            assert_eq!(escrow_bal, expected_open, "escrow balance != liability");
            assert_eq!(
                escrow_bal + settled[a] + refunded[a],
                deposited[a],
                "escrow value not conserved"
            );
            let total_held = escrow_bal
                + tok.balance(&buyers[0])
                + tok.balance(&buyers[1])
                + tok.balance(&sellers[0])
                + tok.balance(&sellers[1]);
            assert_eq!(total_held, INITIAL_MINT * 2, "total asset supply drift");
        }
    }
}
