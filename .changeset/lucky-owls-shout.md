---
"@valbuild/server": patch
---

An endpoint that throws now answers Val's own 500 instead of the framework's.

Nothing caught a throw from an endpoint implementation, so it left the Val
router entirely and became whatever the host does with an unhandled error. On
TanStack Start that is h3, which replaces the message with the literal string
`"HTTPError"` and drops the stack — the same five words for a missing project,
a bad cookie and a module that failed to link — and keeps the real cause on the
server console. Where that console cannot be read (a Cloudflare Worker, for
one), a Val server had no way to say what broke inside it.

Such a request now answers Val's usual error envelope, naming the route, the
method and the cause:

```json
{
  "message": "Val: GET /authorize failed: Project is not set",
  "details": {
    "route": "/authorize",
    "method": "GET",
    "error": "Project is not set"
  }
}
```

The stack is logged rather than returned: `/authorize` and `/enable` are
reachable without a session, and the message is the part a caller can act on.
