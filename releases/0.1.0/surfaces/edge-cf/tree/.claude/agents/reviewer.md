<!-- nina:slot edge-cf.1 -->
| `cloudflare:workers-best-practices` | `{{API_DIR}}/**` |

<!-- nina:slot edge-cf.2 -->
| `cloudflare:durable-objects` | `{{API_DIR}}/src/do/**` or a DO call site |

<!-- nina:slot edge-cf.3 -->
- `{{API_DIR}}/src/do/` (`{{SERIALIZER}}`), a queue consumer, or a webhook receiver touched (serialization + idempotency surface)
