# Encoding Vector Compatibility Log

Every published `encoding-vectors.v<N>.json` has one entry here. Entries are
append-only. A new version must state what changed, why, the backend migration
needed, and the status of the previous version (`retained` or `retired`). See
`README.md` in this directory for the full process.

## v1

- Initial version, generated from `contracts/upto-session/src/encoding_vectors_test.rs`
  against interface version 3.
- Covers session IDs (including the `idempotency_key` payload field), usage
  commitments, usage receipt v1 measurement hashes, addresses, amounts,
  resource hashes, create-session expiry boundaries, and the
  `session_created`, `session_settled`, `session_cancelled` and
  `session_expiry_extended` events.
- Unicode coverage: precomposed (NFC) and decomposed (NFD) Latin text, CJK
  multibyte text, astral emoji with a variation selector, and combining marks in
  canonical and non-canonical order. NFD and non-canonical input is rejected by
  the backend policy, never normalized.
- Backend migration: the TypeScript `deriveSessionId` helper now requires
  `idempotencyKey`, matching the contract's session ID preimage.
