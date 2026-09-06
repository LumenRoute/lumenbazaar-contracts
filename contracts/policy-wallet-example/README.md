# Policy Wallet Example

This package is example code only. It is not production wallet infrastructure, is not audited, and should not custody funds without a full wallet security design.

The contract demonstrates the shape of a policy-controlled smart account for LumenBazaar agents:

- Stores an owner address that authorizes wallet administration.
- Stores the target `upto-session` contract address used by the surrounding application.
- Exposes `require_owner` as the minimal owner gate used by later spending-policy examples.
- Keeps all state in this contract instance so it remains isolated from `upto-session`.
