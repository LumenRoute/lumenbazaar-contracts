//! Quick deterministic fuzz campaign for CI: replays every checked-in seed, a fixed number of
//! mutations of each seed, and a fixed number of generated inputs, for every target. Runs in
//! `cargo test --workspace --all-features` on the stable toolchain.
//!
//! `LUMENBAZAAR_FUZZ_ITERATIONS` overrides the generated-input count per target (default 64).

use lumenbazaar_fuzz::{parse_hex_seed, run_reporting, SplitMix64, Target, TARGETS};
use std::{fs, path::PathBuf};

const DEFAULT_ITERATIONS: u64 = 64;
const MUTATIONS_PER_SEED: u64 = 4;
const SEED: u64 = 0x4c55_4d45_4655_5a5a;
const MAX_INPUT: usize = 128;

fn iterations() -> u64 {
    std::env::var("LUMENBAZAAR_FUZZ_ITERATIONS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_ITERATIONS)
}

fn seeds(target: &str) -> Vec<(String, Vec<u8>)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("seeds")
        .join(target);
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap_or_else(|error| panic!("missing seed directory {}: {error}", dir.display()))
        .map(|entry| entry.expect("seed entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "hex"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no seeds for target {target}");
    files
        .into_iter()
        .map(|path| {
            let text = fs::read_to_string(&path).expect("seed is UTF-8 text");
            let bytes =
                parse_hex_seed(&text).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            (name, bytes)
        })
        .collect()
}

fn target(name: &str) -> Target {
    TARGETS
        .iter()
        .find(|(target, _)| *target == name)
        .map(|(_, run)| *run)
        .expect("known target")
}

fn campaign(name: &str) {
    let run = target(name);
    let stream = name
        .bytes()
        .fold(SEED, |acc, byte| acc.rotate_left(8) ^ u64::from(byte));
    let mut rng = SplitMix64::new(stream);

    for (seed_name, bytes) in seeds(name) {
        eprintln!("{name}: seed {seed_name}");
        run_reporting(name, run, &bytes);
        for _ in 0..MUTATIONS_PER_SEED {
            run_reporting(name, run, &rng.mutate(&bytes, MAX_INPUT));
        }
    }
    for _ in 0..iterations() {
        run_reporting(name, run, &rng.input(MAX_INPUT));
    }
}

#[test]
fn create_seeded_corpus() {
    campaign("create");
}

#[test]
fn settle_seeded_corpus() {
    campaign("settle");
}

#[test]
fn policy_seeded_corpus() {
    campaign("policy");
}

#[test]
fn token_amount_seeded_corpus() {
    campaign("token_amount");
}

#[test]
fn every_target_has_seeds() {
    let names: Vec<&str> = TARGETS.iter().map(|(name, _)| *name).collect();
    assert_eq!(names, ["create", "settle", "policy", "token_amount"]);
    for name in names {
        assert!(!seeds(name).is_empty());
    }
}

#[test]
fn seed_parser_rejects_malformed_files() {
    assert_eq!(parse_hex_seed("# comment only\n"), Ok(vec![]));
    assert_eq!(
        parse_hex_seed("0a 0B # tail\nff"),
        Ok(vec![0x0a, 0x0b, 0xff])
    );
    assert!(parse_hex_seed("abc").is_err());
    assert!(parse_hex_seed("zz").is_err());
}
