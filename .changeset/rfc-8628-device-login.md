---
"@valbuild/server": major
"@valbuild/cli": minor
"@valbuild/language-server": minor
---

`val login` is now an RFC 8628 device authorization grant

The old flow had one value doing two jobs: the token in the verification URL the
user opened was also the credential the CLI polled with to collect the personal
access token. Combined with a verification page that linked the token to
whoever rendered it — no approval step, just a GET — a link sent to a logged-in
Val user was enough for the sender to mint a token on that user's account.

RFC 8628 separates the halves:

- **`device_code`** stays in the CLI and is the only thing that can collect a
  token. It is never displayed, never in a URL, and the server stores only its
  sha256.
- **`user_code`** is a short `XXXX-XXXX` string the user compares against their
  terminal and types into the browser. On its own it collects nothing.

Approving is now an explicit action on a screen that names the machine asking,
so rendering a page can no longer authorize a login. Note that RFC 8628 does not
by itself prevent device-code phishing (§5.4 says as much) — an attacker can
still run the flow and send their own verification link. What closes that is the
consent screen plus the code comparison, which is why the CLI prints the code
and the browser shows it back.

**Breaking, `@valbuild/server`:** the login primitives changed shape.

- `startValLogin()` returns `ValDeviceAuthorization` (`deviceCode`, `userCode`,
  `verificationUri`, `verificationUriComplete`, `expiresInSeconds`,
  `intervalSeconds`) instead of `ValLoginSession` (`nonce`, `url`). It also
  accepts an optional `deviceName`, defaulting to the machine's hostname and
  platform, which is what the approval screen and the token list display.
- `awaitValLoginConfirmation()` takes the whole `ValDeviceAuthorization` rather
  than a nonce string, and derives its timeout and poll interval from it. It
  honours RFC 8628's polling responses, so `slow_down` widens the interval and
  `access_denied` / `expired_token` surface as new `ValLoginError` codes
  `"access-denied"` and `"expired"` rather than running to timeout.
- `ValLoginSession`, `DEFAULT_LOGIN_MAX_DURATION` and
  `DEFAULT_LOGIN_POLL_INTERVAL` are replaced by `ValDeviceAuthorization`,
  `DEFAULT_LOGIN_EXPIRES_IN_SECONDS` and
  `DEFAULT_LOGIN_POLL_INTERVAL_SECONDS`.

`.val/pat.json` is unchanged, so existing tokens keep working and nobody is
logged out by upgrading.

**Requires the matching admin.val.build deploy.** The endpoint contract changed,
so a CLI on this version needs the new server and vice versa. An older CLI
against the new server fails immediately with a message pointing at the upgrade
rather than hanging.
