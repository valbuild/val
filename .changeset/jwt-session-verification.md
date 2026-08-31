---
"@valbuild/server": minor
---

Fix session token verification in `@valbuild/server`

`decodeJwt` had three problems, each of which let a session cookie be accepted
that should not have been:

- **`exp` was never checked.** The payload was parsed and returned as-is, and
  the callers' zod schemas only asserted that `exp` was a number. A session
  cookie was therefore valid forever: the four-day expiry existed only as the
  `expires` attribute on the cookie, which the browser holding it controls. The
  Studio's "session invalid or, most likely, expired" message was never once
  produced by an expiry check.
- **The signature was compared with `!==`.** String comparison short-circuits on
  the first differing byte, which leaks how much of a guessed signature was
  correct.
- **Verification was skipped entirely when `secretKey` was falsy.** One
  forgotten argument — or a `VAL_SECRET` that read as `""` — turned the session
  cookie into an unauthenticated, attacker-writable claim of identity, with no
  error anywhere to say so.

`decodeJwt` is replaced by two functions that cannot be confused for each other:

- `verifyJwt(token, secretKey)` requires the secret, compares the HMAC with
  `crypto.timingSafeEqual`, validates the payload shape, and rejects an expired
  token (with 60s of leeway for clock drift). An empty secret is a failure, not
  a token that validates against `HMAC("")`.
- `decodeJwtWithoutVerifying(token)` is the explicitly-unverified path, for the
  one caller that does not hold the signing key: the app token fetched from
  val.build over an api-key authenticated request.

Both return a `JwtResult` carrying why a token was rejected, so an expired
session is now reported as expired rather than as an invalid token. `alg` was
already pinned to `HS256`, so algorithm confusion was not reachable, and it
still is not. The token itself is no longer written to the debug log.

**Breaking:** `decodeJwt` is no longer exported. Callers passing a secret should
use `verifyJwt` and read `.success`/`.data` instead of a nullable payload.
Existing session cookies keep working until their `exp` passes.
