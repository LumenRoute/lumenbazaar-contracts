#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    lumenbazaar_fuzz::multi_asset(data);
});
