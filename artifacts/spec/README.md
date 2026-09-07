# Contract Specs

The files in this directory are generated contract interface specs. Entries are sorted by kind and
name before serialization so equivalent ABIs produce identical snapshots across supported hosts.

Run `node scripts/generate-specs.mjs` after changing a contract ABI. CI runs the same generator after `stellar contract build --locked` and fails when the committed specs are stale.

Current artifacts:

- `upto-session.json`
- `policy-wallet-example.json`
- `test-token.json`
