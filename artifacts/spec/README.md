# Contract Specs

The files in this directory are generated contract interface specs.

Run `node scripts/generate-specs.mjs` after changing a contract ABI. CI runs the same generator after `stellar contract build --locked` and fails when the committed specs are stale.

Current artifacts:

- `upto-session.xdr-base64.txt`
- `policy-wallet-example.xdr-base64.txt`
- `test-token.xdr-base64.txt`
