<!-- nina:slot edge-cf.1 -->
| New Durable Object behavior | `.claude/architecture.md` § *Durable Objects*, existing `{{API_DIR}}/src/do/` | architect → implementer → the integration gate, where there is one → reviewer → qa |

<!-- nina:slot edge-cf.2 -->
| New Queue handler | `.claude/architecture.md` § *Processing pipeline*, `{{API_DIR}}/src/queues/` | architect → implementer → the integration gate, where there is one → reviewer → qa |

<!-- nina:slot edge-cf.3 -->
| Wrangler / deploy / config | `CLAUDE.md` § *Common commands*, `{{API_DIR}}/wrangler.toml`, `.claude/patterns.md` § *Secrets* | reviewer (sanity check) |
