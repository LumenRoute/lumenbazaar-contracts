use escrow_model::Action;
use lumenbazaar_fuzz::{differential, DiffTraceV1};

#[test]
fn differential_trace_encoding_is_versioned_and_deterministic() {
    let trace = DiffTraceV1::new(vec![
        Action::Initialize {
            admin_authorized: true,
        },
        Action::Create {
            buyer_authorized: true,
            cap: 2,
        },
        Action::Settle {
            seller_authorized: true,
            amount: 1,
        },
    ]);

    let encoded = trace.encode();
    assert_eq!(&encoded[0..8], b"LBDIFF01");
    let decoded = DiffTraceV1::decode(&encoded);
    assert_eq!(trace, decoded);
}

#[test]
fn differential_fuzz_campaign_cross_checks_model_and_contract() {
    // 1. Happy path settlement
    let trace_settle = DiffTraceV1::new(vec![
        Action::Initialize {
            admin_authorized: true,
        },
        Action::Create {
            buyer_authorized: true,
            cap: 2,
        },
        Action::Settle {
            seller_authorized: true,
            amount: 1,
        },
    ]);
    differential(&trace_settle.encode());

    // 2. Happy path cancellation
    let trace_cancel = DiffTraceV1::new(vec![
        Action::Initialize {
            admin_authorized: true,
        },
        Action::Create {
            buyer_authorized: true,
            cap: 2,
        },
        Action::Cancel {
            buyer_authorized: true,
        },
    ]);
    differential(&trace_cancel.encode());

    // 3. Expiry and recovery
    let trace_recover = DiffTraceV1::new(vec![
        Action::Initialize {
            admin_authorized: true,
        },
        Action::Create {
            buyer_authorized: true,
            cap: 2,
        },
        Action::AdvanceToExpiry,
        Action::Recover,
    ]);
    differential(&trace_recover.encode());

    // 4. Unauthorized rejection parity
    let trace_unauth = DiffTraceV1::new(vec![
        Action::Initialize {
            admin_authorized: true,
        },
        Action::Create {
            buyer_authorized: false,
            cap: 2,
        },
        Action::Create {
            buyer_authorized: true,
            cap: 2,
        },
        Action::Settle {
            seller_authorized: false,
            amount: 1,
        },
        Action::Cancel {
            buyer_authorized: false,
        },
        Action::Reject {
            seller_authorized: false,
        },
    ]);
    differential(&trace_unauth.encode());

    // 5. Admin rotation parity
    let trace_admin = DiffTraceV1::new(vec![
        Action::Initialize {
            admin_authorized: true,
        },
        Action::ProposeAdmin {
            caller: 1,
            pending: 2,
            expires_at: 2,
        },
        Action::AcceptAdmin { caller: 2 },
    ]);
    differential(&trace_admin.encode());

    // 6. Asset deprecation and removal parity
    let trace_asset = DiffTraceV1::new(vec![
        Action::Initialize {
            admin_authorized: true,
        },
        Action::DeprecateAsset { caller: 1 },
        Action::RemoveAsset { caller: 1 },
    ]);
    differential(&trace_asset.encode());

    // 7. Pseudo-random traces generated from arbitrary bytes
    for seed in 0..16u64 {
        let data = seed.to_le_bytes();
        differential(&data);
    }
}
