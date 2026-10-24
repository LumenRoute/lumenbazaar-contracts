#![no_main]

// Same code path as the CI seeded-corpus test: lumenbazaar_fuzz::create.
libfuzzer_sys::fuzz_target!(|data: &[u8]| lumenbazaar_fuzz::create(data));
