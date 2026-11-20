use lumenbazaar_fuzz::lifecycle::{run_lifecycle_sequence, LifecycleGenerator};

#[test]
fn arbitrary_lifecycle_generator_produces_authorized_and_unauthorized_histories() {
    let mut gen = LifecycleGenerator::new(0x1234_5678_9abc_def0);
    let ops = gen.generate(32);
    assert!(!ops.is_empty());

    let mut has_authorized = false;
    let mut has_unauthorized = false;
    for op in &ops {
        match op {
            lumenbazaar_fuzz::LifecycleOp::CreateSession { authorized, .. }
            | lumenbazaar_fuzz::LifecycleOp::Settle { authorized, .. }
            | lumenbazaar_fuzz::LifecycleOp::Cancel { authorized, .. }
            | lumenbazaar_fuzz::LifecycleOp::Reject { authorized, .. }
            | lumenbazaar_fuzz::LifecycleOp::SetAssetMaxSessionAmount { authorized, .. }
            | lumenbazaar_fuzz::LifecycleOp::ProposeAdmin { authorized, .. }
            | lumenbazaar_fuzz::LifecycleOp::PauseCreation { authorized } => {
                if *authorized {
                    has_authorized = true;
                } else {
                    has_unauthorized = true;
                }
            }
            _ => {}
        }
    }
    assert!(
        has_authorized,
        "generator should produce authorized operations"
    );
    assert!(
        has_unauthorized,
        "generator should produce unauthorized operations"
    );
}

#[test]
fn arbitrary_lifecycle_sequences_preserve_invariants_across_campaign() {
    for seed in 1..9u64 {
        let mut gen = LifecycleGenerator::new(seed.wrapping_mul(0x517c_c1b7_2722_0a95));
        let ops = gen.generate(12);
        run_lifecycle_sequence(seed, &ops);
    }
}
