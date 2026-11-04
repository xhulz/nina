<!-- nina:slot prisma.1 -->
| Run any `prisma` CLI command (the database gate, devops, and the integration gate where there is one) | `prisma-cli` | flags differ between versions; `migrate diff --shadow-database-url` against a live DB wiped dev/staging once |

<!-- nina:slot prisma.2 -->
| Write or audit a Prisma query (architect, implementer, the database gate, reviewer) | `prisma-client-api` | filters, operators, `$transaction` semantics. a caching or edge layer on top of the client is **NOT covered** — its cache strategy belongs to that layer's own integration doc |
