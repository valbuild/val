---
"@valbuild/ui": patch
---

AI errors can now show what the provider actually said.

The content server sends an optional `details` with a failed turn — provider,
status, error type, request id and the provider's verbatim message — and the
assistant puts it behind a "Details" disclosure. Closed by default, because it
is for whoever is going to act on it; findable without a server log, which is
the point.
