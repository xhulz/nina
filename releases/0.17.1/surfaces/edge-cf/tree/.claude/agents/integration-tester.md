<!-- nina:slot edge-cf.1 -->
| `cloudflare:durable-objects` | DO lifecycle, alarms, RPC, storage — the API surface drifts fast |

<!-- nina:slot edge-cf.2 -->
| `cloudflare:cloudflare` | Queues, R2 or KV bindings |

<!-- nina:slot edge-cf.3 -->
| `cloudflare:wrangler` | anything you run through the wrangler CLI |

<!-- nina:slot edge-cf.4 -->
- Any new Cloudflare binding read/write: R2, KV, Queues, Durable Objects — drive the binding via Miniflare and observe real I/O
