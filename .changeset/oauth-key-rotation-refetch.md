---
"@valbuild/next": patch
"@valbuild/server": patch
---

MCP: survive a signing-key rotation, and say what a refused local token means.

`@valbuild/next` caches the authorization server's JWKS for five minutes. Until
now a token signed with a key that arrived inside that window was refused
outright, so every warm instance rejected valid tokens until the cache expired —
a rotation on the issuer's side showed up as an outage on yours.

A token naming a key the cache does not hold now provokes one refetch of the key
set, at most once per issuer every 30 seconds. The rate limit matters because the
key id comes from the token: without it, unknown key ids would be a way to make
your app call its issuer once per request.

Separately, an MCP call that presents an access token to a project running in
local filesystem mode is still refused — there is nothing to authenticate against
— but the message now names the cause, which is that the project has an `oauth`
issuer configured (often `VAL_OAUTH_ISSUER` in a local `.env`) and should not
have one for local development.
