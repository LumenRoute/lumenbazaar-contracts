//! Storage serialization round-trip corpus for `upto-session`.
//!
//! Generates fixed Soroban ScVal XDR vectors for every persistent and instance
//! `DataKey` and value shape, verifies deterministic encoding and typed
//! round-trip decoding through real contract storage, and pins the committed
//! artifact (`artifacts/interface/storage-corpus-v<N>.json`) via
//! `artifacts/interface/storage-corpus.lock.json` plus storage migration
//! evidence.
//!
//! Regenerate intentionally (only alongside a storage layout version bump and
//! migration evidence) with:
//! `LUMENBAZAAR_UPDATE_STORAGE_CORPUS=1 cargo test -p upto-session --all-features storage_corpus`
//!
//! All addresses and hashes are synthetic repeated-byte values with no secret
//! material or live contract state.

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use soroban_sdk::{
    xdr::{Limits, ReadXdr, ScVal, ToXdr, WriteXdr},
    Address, Bytes, BytesN, Env, IntoVal, String as SorobanString, TryFromVal, TryIntoVal, Val,
    Vec,
};
use std::{
    collections::BTreeSet,
    format,
    path::PathBuf,
    string::{String, ToString},
    vec,
    vec::Vec as StdVec,
};
use upto_session::{
    storage::{DataKey, LAST_VALID_SESSION_SEQUENCE, STORAGE_LAYOUT_VERSION},
    AdminRotation, AssetStatus, CapIncreaseProposal, OperationalState, Session, SessionStatus,
    UptoSessionContract,
};

const UPDATE_ENV: &str = "LUMENBAZAAR_UPDATE_STORAGE_CORPUS";

// Synthetic repeated-byte strkeys with no known secret material.
const CONTRACT_ID: &str = "CDA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4CFV6";
const ADMIN: &str = "GAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCF6M";
const PENDING_ADMIN: &str = "GAZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTHCM6";
const BUYER: &str = "GAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCF6M";
const SELLER: &str = "GARCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCFRVX";
const ASSET_A: &str = "CCS2LJNFUWS2LJNFUWS2LJNFUWS2LJNFUWS2LJNFUWS2LJNFUWS2LSSM";
const ASSET_B: &str = "CBOFYXC4LROFYXC4LROFYXC4LROFYXC4LROFYXC4LROFYXC4LROFZ7GH";

/// Exhaustive mapping of every `DataKey` variant to its canonical corpus name
/// and storage tier. Adding a new `DataKey` variant forces a compile error here
/// until a synthetic vector is added to the corpus.
fn key_metadata(key: &DataKey) -> (&'static str, &'static str) {
    match key {
        DataKey::Admin => ("Admin", "instance"),
        DataKey::AdminRotation => ("AdminRotation", "instance"),
        DataKey::NextSessionSequence => ("NextSessionSequence", "instance"),
        DataKey::Session(_) => ("Session", "persistent"),
        DataKey::StorageLayoutVersion => ("StorageLayoutVersion", "instance"),
        DataKey::SupportedAsset(_) => ("SupportedAsset", "instance"),
        DataKey::AssetMaxSessionAmount(_) => ("AssetMaxSessionAmount", "instance"),
        DataKey::AssetMinSessionAmount(_) => ("AssetMinSessionAmount", "instance"),
        DataKey::CapIncreaseProposal(_) => ("CapIncreaseProposal", "instance"),
        DataKey::SupportedAssets => ("SupportedAssets", "instance"),
        DataKey::OperationalState => ("OperationalState", "instance"),
        DataKey::Liability(_) => ("Liability", "persistent"),
        DataKey::SellerExposureCeiling(_) => ("SellerExposureCeiling", "instance"),
        DataKey::SellerExposure(_, _) => ("SellerExposure", "persistent"),
        DataKey::MaxBuyerOpenSessions => ("MaxBuyerOpenSessions", "instance"),
        DataKey::BuyerOpenSessions(_) => ("BuyerOpenSessions", "persistent"),
        DataKey::MaxSellerOpenSessions => ("MaxSellerOpenSessions", "instance"),
        DataKey::SellerOpenSessions(_) => ("SellerOpenSessions", "persistent"),
        DataKey::AssetExposureCeiling(_) => ("AssetExposureCeiling", "instance"),
        DataKey::BuyerExposureCeiling(_) => ("BuyerExposureCeiling", "instance"),
        DataKey::BuyerExposure(_, _) => ("BuyerExposure", "persistent"),
        DataKey::Idempotency(_, _) => ("Idempotency", "persistent"),
    }
}

const ALL_KEY_VARIANTS: &[&str] = &[
    "Admin",
    "AdminRotation",
    "NextSessionSequence",
    "Session",
    "StorageLayoutVersion",
    "SupportedAsset",
    "AssetMaxSessionAmount",
    "AssetMinSessionAmount",
    "CapIncreaseProposal",
    "SupportedAssets",
    "OperationalState",
    "Liability",
    "SellerExposureCeiling",
    "SellerExposure",
    "MaxBuyerOpenSessions",
    "BuyerOpenSessions",
    "MaxSellerOpenSessions",
    "SellerOpenSessions",
    "AssetExposureCeiling",
    "BuyerExposureCeiling",
    "BuyerExposure",
    "Idempotency",
];

fn interface_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/interface")
}

fn corpus_path(layout_version: u32) -> PathBuf {
    interface_dir().join(format!("storage-corpus-v{layout_version}.json"))
}

fn address(env: &Env, strkey: &str) -> Address {
    Address::from_string(&SorobanString::from_str(env, strkey))
}

fn bytes_to_hex(bytes: &Bytes) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn scval_xdr_hex<T>(env: &Env, value: &T) -> String
where
    T: ToXdr + IntoVal<Env, Val> + Clone,
{
    let host_xdr = bytes_to_hex(&value.clone().to_xdr(env));
    let val: Val = value.clone().into_val(env);
    let scval = ScVal::try_from_val(env, &val).expect("Val must convert to ScVal");
    let xdr_bytes = WriteXdr::to_xdr(&scval, Limits::none()).expect("ScVal must encode to XDR");
    let rust_xdr = hex::encode(xdr_bytes);
    assert_eq!(
        host_xdr, rust_xdr,
        "Soroban host XDR and stellar-xdr bytes must match exactly"
    );
    rust_xdr
}

fn decode_xdr_hex<T>(env: &Env, xdr_hex: &str) -> T
where
    T: TryFromVal<Env, Val>,
    T::Error: core::fmt::Debug,
{
    let raw = hex::decode(xdr_hex).expect("vector XDR hex must decode");
    let scval =
        <ScVal as ReadXdr>::from_xdr(&raw, Limits::none()).expect("XDR bytes must decode to ScVal");
    let val: Val = scval
        .try_into_val(env)
        .expect("ScVal must convert into host Val");
    T::try_from_val(env, &val).expect("host Val must decode to target Rust type")
}

fn round_trip_entry<V>(
    env: &Env,
    contract: &Address,
    name: &str,
    value_type: &str,
    key: &DataKey,
    value: &V,
) -> Value
where
    V: ToXdr + IntoVal<Env, Val> + TryFromVal<Env, Val> + Clone + PartialEq + core::fmt::Debug,
    V::Error: core::fmt::Debug,
{
    let (variant, tier) = key_metadata(key);
    let key_xdr_hex = scval_xdr_hex(env, key);
    let value_xdr_hex = scval_xdr_hex(env, value);

    // Decode from fixed XDR bytes back into typed Rust values and verify exact equality.
    let decoded_key: DataKey = decode_xdr_hex(env, &key_xdr_hex);
    assert_eq!(&decoded_key, key, "key round-trip mismatch for {name}");
    let decoded_value: V = decode_xdr_hex(env, &value_xdr_hex);
    assert_eq!(
        &decoded_value, value,
        "value round-trip mismatch for {name}"
    );

    // Re-encode decoded values to confirm deterministic byte-for-byte stability.
    assert_eq!(
        scval_xdr_hex(env, &decoded_key),
        key_xdr_hex,
        "re-encoded key bytes drifted for {name}"
    );
    assert_eq!(
        scval_xdr_hex(env, &decoded_value),
        value_xdr_hex,
        "re-encoded value bytes drifted for {name}"
    );

    // Write and read through real Soroban instance/persistent storage.
    env.as_contract(contract, || match tier {
        "instance" => {
            env.storage().instance().set(&decoded_key, &decoded_value);
            let stored: V = env
                .storage()
                .instance()
                .get(&decoded_key)
                .expect("instance entry must read back");
            assert_eq!(
                &stored, value,
                "instance storage round-trip mismatch for {name}"
            );
        }
        "persistent" => {
            env.storage().persistent().set(&decoded_key, &decoded_value);
            let stored: V = env
                .storage()
                .persistent()
                .get(&decoded_key)
                .expect("persistent entry must read back");
            assert_eq!(
                &stored, value,
                "persistent storage round-trip mismatch for {name}"
            );
        }
        other => panic!("unexpected storage tier {other}"),
    });

    let mut obj = Map::new();
    obj.insert("name".into(), json!(name));
    obj.insert("tier".into(), json!(tier));
    obj.insert("keyVariant".into(), json!(variant));
    obj.insert("valueType".into(), json!(value_type));
    obj.insert("keyXdrHex".into(), json!(key_xdr_hex));
    obj.insert("valueXdrHex".into(), json!(value_xdr_hex));
    Value::Object(obj)
}

fn generate_corpus() -> Value {
    let env = Env::default();
    let contract = address(&env, CONTRACT_ID);
    env.register_at(&contract, UptoSessionContract, ());

    let admin = address(&env, ADMIN);
    let pending_admin = address(&env, PENDING_ADMIN);
    let buyer = address(&env, BUYER);
    let seller = address(&env, SELLER);
    let asset_a = address(&env, ASSET_A);
    let asset_b = address(&env, ASSET_B);

    let session_id_open = BytesN::from_array(&env, &[0x11; 32]);
    let session_id_settled = BytesN::from_array(&env, &[0x22; 32]);
    let session_id_cancelled = BytesN::from_array(&env, &[0x33; 32]);
    let session_id_expired = BytesN::from_array(&env, &[0x44; 32]);
    let session_id_rejected = BytesN::from_array(&env, &[0x55; 32]);
    let resource_hash = BytesN::from_array(&env, &[0x09; 32]);
    let usage_hash = BytesN::from_array(&env, &[0x7a; 32]);
    let idempotency_key = BytesN::from_array(&env, &[0x08; 32]);

    let mut vectors: StdVec<Value> = vec![
        // Instance keys
        round_trip_entry(
            &env,
            &contract,
            "instance-admin",
            "Address",
            &DataKey::Admin,
            &admin,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-admin-rotation",
            "AdminRotation",
            &DataKey::AdminRotation,
            &AdminRotation {
                pending_admin: pending_admin.clone(),
                expires_at_ledger: 5_067_600,
            },
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-next-session-sequence-zero",
            "u64",
            &DataKey::NextSessionSequence,
            &0u64,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-next-session-sequence-last-valid",
            "u64",
            &DataKey::NextSessionSequence,
            &LAST_VALID_SESSION_SEQUENCE,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-next-session-sequence-exhausted",
            "u64",
            &DataKey::NextSessionSequence,
            &u64::MAX,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-storage-layout-version",
            "u32",
            &DataKey::StorageLayoutVersion,
            &STORAGE_LAYOUT_VERSION,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-supported-asset-active",
            "AssetStatus",
            &DataKey::SupportedAsset(asset_a.clone()),
            &AssetStatus::Active,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-supported-asset-deprecated",
            "AssetStatus",
            &DataKey::SupportedAsset(asset_b.clone()),
            &AssetStatus::Deprecated,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-asset-max-session-amount-typical",
            "i128",
            &DataKey::AssetMaxSessionAmount(asset_a.clone()),
            &1_000_000_000i128,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-asset-max-session-amount-i128-max",
            "i128",
            &DataKey::AssetMaxSessionAmount(asset_b.clone()),
            &i128::MAX,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-asset-min-session-amount",
            "i128",
            &DataKey::AssetMinSessionAmount(asset_a.clone()),
            &1i128,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-cap-increase-proposal",
            "CapIncreaseProposal",
            &DataKey::CapIncreaseProposal(asset_a.clone()),
            &CapIncreaseProposal {
                proposed_max_amount: 5_000_000_000,
                active_at_ledger: 5_000_100,
                expires_at_ledger: 5_017_380,
            },
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-supported-assets-empty",
            "Vec<Address>",
            &DataKey::SupportedAssets,
            &Vec::<Address>::new(&env),
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-supported-assets-multi",
            "Vec<Address>",
            &DataKey::SupportedAssets,
            &soroban_sdk::vec![&env, asset_a.clone(), asset_b.clone()],
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-operational-state-active",
            "OperationalState",
            &DataKey::OperationalState,
            &OperationalState::Active,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-operational-state-paused",
            "OperationalState",
            &DataKey::OperationalState,
            &OperationalState::Paused,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-operational-state-deprecated",
            "OperationalState",
            &DataKey::OperationalState,
            &OperationalState::Deprecated,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-seller-exposure-ceiling",
            "i128",
            &DataKey::SellerExposureCeiling(asset_a.clone()),
            &50_000_000_000i128,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-max-buyer-open-sessions",
            "u32",
            &DataKey::MaxBuyerOpenSessions,
            &32u32,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-max-seller-open-sessions",
            "u32",
            &DataKey::MaxSellerOpenSessions,
            &64u32,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-asset-exposure-ceiling",
            "i128",
            &DataKey::AssetExposureCeiling(asset_a.clone()),
            &100_000_000_000i128,
        ),
        round_trip_entry(
            &env,
            &contract,
            "instance-buyer-exposure-ceiling",
            "i128",
            &DataKey::BuyerExposureCeiling(asset_a.clone()),
            &10_000_000_000i128,
        ),
        // Persistent keys
        round_trip_entry(
            &env,
            &contract,
            "persistent-session-open",
            "Session",
            &DataKey::Session(session_id_open.clone()),
            &Session {
                id: session_id_open.clone(),
                buyer: buyer.clone(),
                seller: seller.clone(),
                asset: asset_a.clone(),
                max_amount: 420_000_000,
                escrowed_amount: 420_000_000,
                settled_amount: 0,
                expires_at_ledger: 5_067_600,
                resource_hash: resource_hash.clone(),
                usage_hash: None,
                status: SessionStatus::Open,
                creation_ledger: 5_067_000,
                finalized_ledger: None,
                resource_scheme_version: 1,
                usage_scheme_version: None,
            },
        ),
        round_trip_entry(
            &env,
            &contract,
            "persistent-session-settled",
            "Session",
            &DataKey::Session(session_id_settled.clone()),
            &Session {
                id: session_id_settled.clone(),
                buyer: buyer.clone(),
                seller: seller.clone(),
                asset: asset_a.clone(),
                max_amount: 420_000_000,
                escrowed_amount: 0,
                settled_amount: 210_000_000,
                expires_at_ledger: 5_067_600,
                resource_hash: resource_hash.clone(),
                usage_hash: Some(usage_hash.clone()),
                status: SessionStatus::Settled,
                creation_ledger: 5_067_000,
                finalized_ledger: Some(5_067_123),
                resource_scheme_version: 1,
                usage_scheme_version: Some(1),
            },
        ),
        round_trip_entry(
            &env,
            &contract,
            "persistent-session-cancelled",
            "Session",
            &DataKey::Session(session_id_cancelled.clone()),
            &Session {
                id: session_id_cancelled.clone(),
                buyer: buyer.clone(),
                seller: seller.clone(),
                asset: asset_a.clone(),
                max_amount: 100_000,
                escrowed_amount: 0,
                settled_amount: 0,
                expires_at_ledger: 5_067_600,
                resource_hash: resource_hash.clone(),
                usage_hash: None,
                status: SessionStatus::Cancelled,
                creation_ledger: 5_067_000,
                finalized_ledger: Some(5_067_050),
                resource_scheme_version: 1,
                usage_scheme_version: None,
            },
        ),
        round_trip_entry(
            &env,
            &contract,
            "persistent-session-expired",
            "Session",
            &DataKey::Session(session_id_expired.clone()),
            &Session {
                id: session_id_expired.clone(),
                buyer: buyer.clone(),
                seller: seller.clone(),
                asset: asset_b.clone(),
                max_amount: 100_000,
                escrowed_amount: 0,
                settled_amount: 0,
                expires_at_ledger: 5_067_600,
                resource_hash: resource_hash.clone(),
                usage_hash: None,
                status: SessionStatus::Expired,
                creation_ledger: 5_067_000,
                finalized_ledger: Some(5_067_600),
                resource_scheme_version: 1,
                usage_scheme_version: None,
            },
        ),
        round_trip_entry(
            &env,
            &contract,
            "persistent-session-rejected",
            "Session",
            &DataKey::Session(session_id_rejected.clone()),
            &Session {
                id: session_id_rejected.clone(),
                buyer: buyer.clone(),
                seller: seller.clone(),
                asset: asset_b.clone(),
                max_amount: 100_000,
                escrowed_amount: 0,
                settled_amount: 0,
                expires_at_ledger: 5_067_600,
                resource_hash: resource_hash.clone(),
                usage_hash: None,
                status: SessionStatus::Rejected,
                creation_ledger: 5_067_000,
                finalized_ledger: Some(5_067_025),
                resource_scheme_version: 1,
                usage_scheme_version: None,
            },
        ),
        round_trip_entry(
            &env,
            &contract,
            "persistent-liability-zero",
            "i128",
            &DataKey::Liability(asset_b.clone()),
            &0i128,
        ),
        round_trip_entry(
            &env,
            &contract,
            "persistent-liability-nonzero",
            "i128",
            &DataKey::Liability(asset_a.clone()),
            &420_000_000i128,
        ),
        round_trip_entry(
            &env,
            &contract,
            "persistent-seller-exposure",
            "i128",
            &DataKey::SellerExposure(seller.clone(), asset_a.clone()),
            &420_000_000i128,
        ),
        round_trip_entry(
            &env,
            &contract,
            "persistent-buyer-open-sessions",
            "u32",
            &DataKey::BuyerOpenSessions(buyer.clone()),
            &3u32,
        ),
        round_trip_entry(
            &env,
            &contract,
            "persistent-seller-open-sessions",
            "u32",
            &DataKey::SellerOpenSessions(seller.clone()),
            &5u32,
        ),
        round_trip_entry(
            &env,
            &contract,
            "persistent-buyer-exposure",
            "i128",
            &DataKey::BuyerExposure(buyer.clone(), asset_a.clone()),
            &420_000_000i128,
        ),
        round_trip_entry(
            &env,
            &contract,
            "persistent-idempotency",
            "BytesN<32>",
            &DataKey::Idempotency(buyer.clone(), idempotency_key.clone()),
            &session_id_open.clone(),
        ),
    ];

    // Sort by vector name so JSON output is strictly deterministic.
    vectors.sort_by(|a, b| {
        a["name"]
            .as_str()
            .unwrap_or("")
            .cmp(b["name"].as_str().unwrap_or(""))
    });

    json!({
        "schema": "lumenbazaar/storage-serialization-corpus",
        "storageLayoutVersion": STORAGE_LAYOUT_VERSION,
        "generator": "contracts/upto-session/tests/storage_corpus.rs",
        "regenerate": format!(
            "{UPDATE_ENV}=1 cargo test -p upto-session --test storage_corpus --all-features"
        ),
        "synthetic": "All addresses and hashes are repeated-byte synthetic values with no secret material or live contract state.",
        "vectors": vectors,
    })
}

fn render(value: &Value) -> String {
    let mut out = serde_json::to_string_pretty(value).expect("corpus must serialize");
    out.push('\n');
    out
}

#[test]
fn storage_corpus_covers_every_data_key_variant() {
    let corpus = generate_corpus();
    let covered: BTreeSet<String> = corpus["vectors"]
        .as_array()
        .expect("vectors array")
        .iter()
        .map(|v| v["keyVariant"].as_str().expect("keyVariant").to_string())
        .collect();
    let expected: BTreeSet<String> = ALL_KEY_VARIANTS.iter().map(|s| (*s).to_string()).collect();
    assert_eq!(
        covered, expected,
        "storage corpus must cover every DataKey variant in instance and persistent storage"
    );
}

#[test]
fn storage_corpus_generation_is_deterministic() {
    assert_eq!(render(&generate_corpus()), render(&generate_corpus()));
}

#[test]
fn storage_corpus_matches_committed_artifact() {
    let generated = render(&generate_corpus());
    let path = corpus_path(STORAGE_LAYOUT_VERSION);
    if std::env::var(UPDATE_ENV).as_deref() == Ok("1") {
        std::fs::write(&path, &generated).expect("storage corpus artifact must be writable");
        return;
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "missing {}; run `{UPDATE_ENV}=1 cargo test -p upto-session --all-features storage_corpus`",
            path.display()
        )
    });
    assert!(
        committed == generated,
        "{} drifted from current storage serialization. Intentional drift requires bumping \
         STORAGE_LAYOUT_VERSION, generating a new versioned corpus, updating \
         artifacts/interface/storage-corpus.lock.json, and committing storage migration evidence.",
        path.display()
    );
}

#[test]
fn storage_corpus_decodes_committed_xdr_vectors() {
    let path = corpus_path(STORAGE_LAYOUT_VERSION);
    if std::env::var(UPDATE_ENV).as_deref() == Ok("1") && !path.exists() {
        return;
    }
    let committed: Value = serde_json::from_str(
        &std::fs::read_to_string(&path).expect("committed storage corpus must exist"),
    )
    .expect("committed storage corpus must parse");

    let env = Env::default();
    let vectors = committed["vectors"].as_array().expect("vectors array");
    assert!(!vectors.is_empty());

    for entry in vectors {
        let name = entry["name"].as_str().expect("name");
        let key_hex = entry["keyXdrHex"].as_str().expect("keyXdrHex");
        let value_hex = entry["valueXdrHex"].as_str().expect("valueXdrHex");
        let value_type = entry["valueType"].as_str().expect("valueType");

        let decoded_key: DataKey = decode_xdr_hex(&env, key_hex);
        assert_eq!(
            scval_xdr_hex(&env, &decoded_key),
            key_hex,
            "committed key XDR round-trip failed for {name}"
        );

        let reencoded_value = match value_type {
            "Address" => scval_xdr_hex(&env, &decode_xdr_hex::<Address>(&env, value_hex)),
            "AdminRotation" => {
                scval_xdr_hex(&env, &decode_xdr_hex::<AdminRotation>(&env, value_hex))
            }
            "u64" => scval_xdr_hex(&env, &decode_xdr_hex::<u64>(&env, value_hex)),
            "u32" => scval_xdr_hex(&env, &decode_xdr_hex::<u32>(&env, value_hex)),
            "i128" => scval_xdr_hex(&env, &decode_xdr_hex::<i128>(&env, value_hex)),
            "AssetStatus" => scval_xdr_hex(&env, &decode_xdr_hex::<AssetStatus>(&env, value_hex)),
            "CapIncreaseProposal" => scval_xdr_hex(
                &env,
                &decode_xdr_hex::<CapIncreaseProposal>(&env, value_hex),
            ),
            "Vec<Address>" => scval_xdr_hex(&env, &decode_xdr_hex::<Vec<Address>>(&env, value_hex)),
            "OperationalState" => {
                scval_xdr_hex(&env, &decode_xdr_hex::<OperationalState>(&env, value_hex))
            }
            "Session" => scval_xdr_hex(&env, &decode_xdr_hex::<Session>(&env, value_hex)),
            "BytesN<32>" => scval_xdr_hex(&env, &decode_xdr_hex::<BytesN<32>>(&env, value_hex)),
            other => panic!("unhandled valueType {other} in committed storage corpus"),
        };
        assert_eq!(
            reencoded_value, value_hex,
            "committed value XDR round-trip failed for {name}"
        );
    }
}

#[test]
fn storage_corpus_is_pinned_by_lock_and_migration_evidence() {
    let dir = interface_dir();
    let lock_path = dir.join("storage-corpus.lock.json");
    if std::env::var(UPDATE_ENV).as_deref() == Ok("1") && !lock_path.exists() {
        return;
    }
    let lock: Value = serde_json::from_str(
        &std::fs::read_to_string(&lock_path).expect("storage-corpus.lock.json must exist"),
    )
    .expect("storage-corpus.lock.json must parse");

    assert_eq!(
        lock["currentLayoutVersion"],
        json!(STORAGE_LAYOUT_VERSION),
        "storage-corpus.lock.json currentLayoutVersion must match STORAGE_LAYOUT_VERSION"
    );

    let entry = &lock["versions"][STORAGE_LAYOUT_VERSION.to_string()];
    let expected_file = format!("storage-corpus-v{STORAGE_LAYOUT_VERSION}.json");
    assert_eq!(
        entry["file"],
        json!(expected_file),
        "lock entry must name {expected_file}"
    );

    let bytes = std::fs::read(dir.join(&expected_file)).expect("corpus file must exist");
    let actual_sha = hex::encode(Sha256::digest(&bytes));
    assert_eq!(
        entry["sha256"],
        json!(actual_sha),
        "{expected_file} changed without a layout version bump and migration evidence. \
         Existing storage corpus versions are immutable."
    );

    if STORAGE_LAYOUT_VERSION > 1 {
        let migration_rel = entry["migrationEvidence"]
            .as_str()
            .expect("migrationEvidence path is required for STORAGE_LAYOUT_VERSION > 1");
        let migration_path = dir.join(migration_rel);
        let migration: Value = serde_json::from_str(
            &std::fs::read_to_string(&migration_path).unwrap_or_else(|_| {
                panic!(
                    "missing storage migration evidence at {}",
                    migration_path.display()
                )
            }),
        )
        .expect("storage migration evidence must be valid JSON");
        assert_eq!(
            migration["toInterfaceVersion"],
            json!(STORAGE_LAYOUT_VERSION),
            "storage migration evidence must target STORAGE_LAYOUT_VERSION {STORAGE_LAYOUT_VERSION}"
        );
    }
}
