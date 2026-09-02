---
"@valbuild/server": minor
"@valbuild/next": minor
---

Accept OAuth access tokens on the MCP endpoint, so editors can authorize as themselves

`initValMcp` takes an optional `oauth` config. Give it the authorization server's
URL and this endpoint's own URL, and every MCP call must then present an access
token that Val's authorization server issued:

```ts
const { valMcpAuthorize, valMcpTools, valMcpMetadata } = initValMcp(
  valModules,
  config,
  {
    oauth: {
      issuer: "https://admin.val.build",
      resource: "https://your-app.com/api/mcp",
    },
  },
);
```

The token is verified in your app — signature against the issuer's published
keys, plus issuer, audience and expiry — so the caller's identity is checked
rather than claimed. **Patches created over MCP now carry that profile as their
author**, which is what makes an edit made from a phone show up in the review
screen as somebody's rather than nobody's. Scopes are enforced too: a token
without `val:write` cannot reach a tool that writes.

Mount the discovery document so clients can find where to authorize:

```ts
// app/.well-known/oauth-protected-resource/route.ts
import { valMcpMetadata } from "../../../val/mcp";
export const { GET, OPTIONS } = valMcpMetadata!;
```

`valMcpMetadata` is `null` when no `oauth` config is given.

**Nothing changes if you leave `oauth` out.** Local development still works with
no authorization server, and an app already using a personal access token keeps
working as before.

One breaking change if you built your own host on `createValTools`:
`ValToolContext.auth` is now a tagged union, so `{ pat }` becomes
`{ type: "pat", pat }`. The new variant is
`{ type: "verified-profile", profileId, scopes }`, for a host that verified a
token itself.
