<!-- nina:slot pii.1 -->
8. **Sensitive data — LGPD applies.** KYC documents and bank/PIX data are sensitive. Encryption at rest (R2 native + Postgres TLS via Accelerate). No PII (CPF/CNPJ, account numbers, PIX keys, document images) in logs. KYC document bytes live only in R2, never in Postgres in clear text.
