#![no_main]

// Same code path as the CI seeded-corpus test: lumenbazaar_fuzz::policy.
libfuzzer_sys::fuzz_target!(|data: &[u8]| lumenbazaar_fuzz::policy(data));
