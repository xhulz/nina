<!-- nina:slot pii.1 -->
- Check for obvious security / privacy regressions (LGPD applies): no PII or secrets in logs — **no CPF/CNPJ, account numbers, PIX keys, or KYC document data** ever logged; KYC document bytes live only in R2, never plaintext in Postgres; no leaked secrets.
