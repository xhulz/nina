<!-- nina:slot db.1 -->

### DBA is a guardrail, not a stage
Invoke **dba** any time Prisma is touched — regardless of where you are in the pipeline. No Prisma change merges without dba approval. Reviewer verifies dba ran.

<!-- nina:slot db.2 -->
| any `prisma` CLI command | **`prisma-cli`** |

<!-- nina:slot db.3 -->
| a new or changed Prisma query | **`prisma-client-api`** (a caching or edge layer on top of the client is not covered — its own integration doc owns that) |
