<!-- nina:slot blockchain.1 -->
| a contract deployment, or a proxy upgrade | **`upgrade-solidity-contracts`** |

<!-- nina:slot blockchain.2 -->
- **`solidity-auditor` returned `APPROVED` for this exact diff**, and a contract deploy names the network, the deployer, and the rollback — which for a non-upgradeable contract is a redeploy and a migration of state, not a revert. Say so before deploying, not after. A deploy to a network carrying real value needs an explicit go from {{OWNER}} for that change, the same as production.
