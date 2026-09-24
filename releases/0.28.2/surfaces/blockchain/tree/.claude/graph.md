<!-- nina:slot blockchain.1 -->
- `solidity-dev` — writes contract code, which cannot be changed once it is live
- `solidity-auditor` — gate: audits contract code as an attacker before anything deploys

<!-- nina:slot blockchain.2 -->
- `architect` → `solidity-dev` on `SPEC-READY` — the spec changes contract code
- `solidity-dev` → `solidity-auditor` on `DIFF-READY`
- `solidity-dev` → `architect` on `BLOCKED` — the change cannot be made safely as specified · max 2
- `solidity-auditor` → `reviewer` on `APPROVED`
- `solidity-auditor` → `solidity-dev` on `REJECTED` — a flaw in the contract code · max 2
- `solidity-auditor` → `architect` on `REJECTED` — a flaw in the design · max 2
