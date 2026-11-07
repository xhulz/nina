<!-- nina:slot blockchain.1 -->

### Solidity-auditor is a guardrail for contract changes
Invoke **solidity-auditor** on any diff that touches `{{CONTRACTS_DIR}}`, a deploy script, or the version of a contracts library — regardless of where you are in the pipeline. No contract change merges without its approval, and none deploys without it. Reviewer verifies it ran; devops verifies it approved.

Contract sources are written by **solidity-dev**, not the implementer. Route the work there when the spec's file list reaches `{{CONTRACTS_DIR}}`, and keep the implementer on the off-chain side of the same feature.
