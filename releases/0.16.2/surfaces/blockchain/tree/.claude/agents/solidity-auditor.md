<!-- nina:slot blockchain.1 -->
| **`develop-secure-contracts`** | any library component in the diff — to check the usage against the library's own guidance, not against memory |

<!-- nina:slot blockchain.2 -->
| **`upgrade-solidity-contracts`** | a proxy, an initializer, or a storage layout change |

<!-- nina:slot blockchain.3 -->
| **`security-audit`** | the off-chain half — deploy scripts, key handling, CI, RPC endpoints (guidance mode) |

<!-- nina:slot blockchain.4 -->
- The deployed addresses and role holders in play, where the change targets a live system.

<!-- nina:slot blockchain.5 -->
- **An event for every state change**, and that what it emits matches what was written. Off-chain
  reconstruction is the only history there is, and a wrong event is worse than a missing one.

<!-- nina:slot blockchain.6 -->
- Approve a change to a live contract without stating the upgrade path and naming who can execute it.
