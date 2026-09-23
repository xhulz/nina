<!-- nina:slot pii.1 -->

**Point it at an UNAUTHENTICATED route — `/login` is the right one.** Never sign in, and never
screenshot a signed-in page. The tester account on the deployed environments holds real KYC data:
CPF, PIX keys, bank details. A screenshot or a console dump of a signed-in page pulls that into
agent transcripts and logs, which is a Hard Rule #8 (LGPD) leak with no upside here — `/login`
already proves everything this check is for. It renders from the same bundle, it exercises the same
`VITE_API_BASE_URL` inlining (a missing one blanks it identically), and it needs no session.
