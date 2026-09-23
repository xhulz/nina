<!-- nina:slot blockchain.1 -->
| **`setup-solidity-contracts`** | a new contract project, a dependency install, or import/remapping configuration |

<!-- nina:slot blockchain.2 -->
| **`develop-secure-contracts`** | any library component — token standards, access control, pausing, reentrancy protection |

<!-- nina:slot blockchain.3 -->
| **`upgrade-solidity-contracts`** | a proxy, an initializer, or anything that moves storage |

<!-- nina:slot blockchain.4 -->
- The contract's deployed state, where one exists. A change to a live contract is an upgrade with a
  storage layout to preserve, not an edit.

<!-- nina:slot blockchain.5 -->
- Widen a function's visibility, or add an address to a role, to make a test pass. The test is
  describing the access control; fix the test or reject the spec.
