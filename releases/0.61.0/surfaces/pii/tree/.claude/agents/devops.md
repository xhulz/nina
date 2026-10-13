<!-- nina:slot pii.1 -->

**Point it at an UNAUTHENTICATED route — a sign-in page is the right one.** Never sign in, and never
screenshot a signed-in page. Accounts on deployed environments hold real personal data, and a
screenshot or a console dump pulls it into agent transcripts and logs, where it persists and nobody
ever looks for it again. That is a privacy leak with no upside here: the sign-in page proves
everything this check is for. It renders from the same bundle, it exercises the same build-time env
inlining (a missing variable blanks it identically), and it needs no session.
