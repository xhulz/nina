<!-- nina:slot db.1 -->
| `prisma-cli` | a Prisma CLI command |

<!-- nina:slot db.2 -->
- Any new Prisma query against an Accelerate-cached read path — verify cache hit/`cacheStrategy` behavior live (dba covers schema; you cover runtime cache behavior)

<!-- nina:slot db.3 -->
If you find a Prisma issue mid-run (a query behaves differently against a real DB than the dba's static analysis suggested) — escalate to **dba**, do not fix yourself.
