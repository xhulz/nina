<!-- nina:slot pii.1 -->
4. **LGPD / PII (Hard Rule #8)** — CPF/CNPJ, account numbers, PIX keys, KYC document bytes are sensitive. They must NEVER appear in logs, API responses that don't need them, or Postgres in cleartext (KYC bytes only in R2). Verify `/v1/me` and any new endpoint excludes `document` and other PII from its select/response. Check error paths don't leak PII.
