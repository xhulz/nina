<!-- nina:slot blockchain.1 -->
- **Contract guardrail** → deployed code is immutable and permanently callable by anyone, so a defect is not a patch away and "nothing calls this" is not a property of it. Reentrancy, a state-changing function with no access control, a storage layout broken by an upgrade, and an audited component used against its own guidance are caught here.

<!-- nina:slot blockchain.2 -->
| **solidity-dev** | Write contract sources and their adversarial tests to spec; never deploys | `.claude/agents/solidity-dev.md` |
| **solidity-auditor** | Mandatory gate on any contract diff; blocks reviewer and devops | `.claude/agents/solidity-auditor.md` |
