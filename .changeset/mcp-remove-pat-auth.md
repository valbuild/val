---
"@valbuild/next": minor
"@valbuild/server": minor
---

MCP: remove personal access token auth. The endpoint now needs an `oauth`
config, or local filesystem mode.

Until now, an MCP endpoint with no `oauth` config accepted whatever bearer token
a caller presented and relayed it to the Val content backend unread. The
reasoning was that without an issuer the app has no key to check a token
against, so it should not pretend to be the authority on what that token may
do — and that much was right. The shape was not: a credential the app cannot
check is one it cannot refuse either, so "a deployed endpoint that authenticates
nobody" was a supported configuration, and an app could serve content-rewriting
tools without ever being told where its callers should authorize.

**If you run Val in proxy mode**, MCP now requires the `oauth` config that
shipped in `0.120.0`. Callers authorize as themselves against the Val
authorization server, this app verifies the token's signature, issuer, audience
and expiry itself, and patches carry the verified profile as their author:

```ts
initValMcp(valModules, config, {
  oauth: {
    issuer: "https://admin.val.build",
    resource: "https://your-app.com/api/mcp",
  },
});
```

Leave it out and the endpoint answers `500` naming the missing config, rather
than serving the request.

**If you run Val in local filesystem mode**, nothing changes. Local development
still needs no `oauth` config and no authorization server: there is no backend
to authenticate to, patches are written with no author, and a token presented
to such a project is still refused rather than ignored.

Two API changes if you built your own host on `createValTools`:

- `ValToolContext.auth` no longer has a `{ type: "pat", pat }` variant.
  `{ type: "verified-profile", profileId, scopes }` is the only credential the
  registry accepts, and `null` still means local filesystem mode.
- `createValOps` no longer takes an `auth` argument. `ValOpsHttp` still accepts
  a personal access token directly — that is how `val debug` uses the token from
  `val login` — but no server request builds one.

Proxy mode also stops keeping one data layer per credential. Each personal
access token needed its own `ValOpsHttp` to hold it, each of those cached the
project's evaluated modules, and the bounded cache that kept the memory in
check turned an eviction into a re-evaluation of every module on the next call.
Verified callers all share one instance, because they all reach the backend
under the app's own API key.
