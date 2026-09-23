<!-- nina:slot external-api.1 -->
5. **Integration flag** — if any subtask touches an external-library surface ({{AUTH_LIB}}, Prisma Accelerate cache, R2/KV/Queues/Durable Objects bindings, third-party HTTP) OR the {{PROVIDER}} surface (`{{PROVIDER_PKG}}/**` or a new {{PROVIDER}} client call), mark **"INTEGRATION-TESTER REQUIRED"** on that subtask.
