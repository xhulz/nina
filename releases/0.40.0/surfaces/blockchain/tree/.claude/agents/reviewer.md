<!-- nina:slot blockchain.1 -->
- **The solidity-auditor gate ran and returned `APPROVED`** for any diff touching `{{CONTRACTS_DIR}}`, a deploy script, or a contracts library version. Its absence is a blocking finding on its own, whatever the diff looks like to you.

<!-- nina:slot blockchain.2 -->
- A contract change written by the implementer rather than **solidity-dev** is rejected on routing alone. The two roles carry different rules about what a defect costs, and the cheaper set is the wrong one here.
