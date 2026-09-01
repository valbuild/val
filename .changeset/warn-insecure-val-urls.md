---
"@valbuild/server": patch
---

Warn when `valBuildUrl` or `valContentUrl` is configured over plain http

Both default to https, but each is overridable — `opts.valBuildUrl` /
`VAL_BUILD_URL` and `opts.valContentUrl` / `VAL_CONTENT_URL` — and neither
override has ever been scheme-checked. Point one at a plain http host and the
project's api key goes out in clear text, and whatever comes back is whatever
the network says it is: for `valBuildUrl` that includes the app token the
server re-signs into the session cookie.

Val now writes a warning on startup naming the option and the URL. Loopback
over http is exempt, since that is a val.build running on the developer's own
machine.

This warns rather than refuses to boot: both overrides are set by the operator
rather than by an attacker, so it is a misconfiguration to surface, not
untrusted input to reject, and rejecting would break anyone deliberately
pointing at an internal http host today.
