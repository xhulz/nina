<!-- nina:slot blockchain.1 -->
| a contract, a proxy, or a contracts library component | **`develop-secure-contracts`** · **`upgrade-solidity-contracts`** when storage moves |

<!-- nina:slot blockchain.2 -->
11c. **Contract surface (MANDATORY when the spec reaches `{{CONTRACTS_DIR}}`).** Name which contracts are touched and whether each is deployed; for a deployed one, say whether this is an upgrade and what preserves the storage layout. State the access-control model in roles, not in adjectives: who may call each state-changing function, and how that role is granted and revoked. List the adversarial tests the implementation owes — re-entry, the unauthorized caller, the boundary amount, the second call that must fail. A spec that reaches a contract and leaves any of these to the implementer is rejected.
