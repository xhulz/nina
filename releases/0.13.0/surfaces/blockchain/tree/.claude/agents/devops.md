<!-- nina:slot blockchain.1 -->
- **`upgrade-solidity-contracts`** — before deploying a contract or executing a proxy upgrade, to check the storage layout against what is live.

<!-- nina:slot blockchain.2 -->
7b. **A contract deploy needs `solidity-auditor` `APPROVED` for this exact diff**, and its rollback named before it runs — which for a non-upgradeable contract is a redeploy plus a migration of state, not a revert. Say so *before* deploying. A deploy to a network carrying real value needs an explicit go from {{OWNER}} for that change, the same as production.
