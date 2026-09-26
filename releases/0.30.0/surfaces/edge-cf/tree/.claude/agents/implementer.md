<!-- nina:slot edge-cf.1 -->
| `cloudflare:workers-best-practices` | anything under `{{API_DIR}}/**` |

<!-- nina:slot edge-cf.2 -->
| `cloudflare:durable-objects` | anything under `{{API_DIR}}/src/do/**` or a DO call site |

<!-- nina:slot edge-cf.3 -->
| `cloudflare:cloudflare` | a queue consumer, or R2 / KV access |

<!-- nina:slot edge-cf.4 -->
| `cloudflare:wrangler` | a change to `wrangler.toml` |

<!-- nina:slot edge-cf.5 -->
- Respect Workers conventions: secrets in `{{SECRETS_LOCAL}}` for local dev (never commit), `compatibility_flags = ["nodejs_compat"]` in `wrangler.toml`.
