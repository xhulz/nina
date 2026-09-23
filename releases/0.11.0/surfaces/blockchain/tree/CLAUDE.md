<!-- nina:slot blockchain.1 -->
16. **Every contract change goes through the solidity-auditor gate, and deployed code is never patched in place.** A diff touching a contract source, a deploy script, or the version of a contracts library does not reach the reviewer without `VERDICT: APPROVED` from **solidity-auditor**, and does not reach any network without it. Contract sources are written by **solidity-dev**, not by the implementer — the implementer's rules assume a defect is a patch away, and here it is a redeploy or a proxy upgrade at best. Private keys, mnemonics and funded accounts never enter the repository in any form, test fixtures included.

<!-- nina:slot blockchain.2 -->
| **ANY step touching a contract, a deploy script, or a contracts library version** | **architect → solidity-dev → solidity-auditor → reviewer → qa** — the auditor is mandatory and blocks the reviewer |

<!-- nina:slot blockchain.3 -->
- **solidity-dev** → write contract sources and their adversarial tests strictly to spec; never deploys, never widens access control to make a test pass
- **solidity-auditor** → **mandatory gate** on any contract diff; `APPROVED` required before reviewer and before any deploy
