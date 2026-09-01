---
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/next": minor
"@valbuild/ui": patch
---

Add a server-side tool registry, and serve Val's content tools over MCP

`createValTools` (from `@valbuild/server`) exposes Val's content tools over
`ValOps` rather than the Studio's browser stores, so an agent with no browser can
read and change content: seven reading tools and four writing ones, under the
same names the Studio's chat uses. Nothing in it imports an MCP SDK — a host
adapts the result type at its own edge.

`initValMcp` (from `@valbuild/next/server`) is the app-facing half: it resolves
the project's configuration, hands back the registry, and decides per request
whether a call may reach it. `examples/next` shows the ~90 lines of transport
glue on top.

In proxy mode every call carries the caller's own personal access token to the
Val content backend, so the backend decides what that caller may do; a call with
no credential is refused rather than falling back to the app's API key. The MCP
endpoint is not served in local filesystem mode outside development, where there
is no credential in the path at all, and a cross-origin request is refused so a
web page cannot drive a developer's own dev server.

Three fixes to behaviour that is shared with the Studio's chat tools:

- Duplicating or scaffolding onto an existing record key is refused instead of
  silently replacing the entry that was there.
- `buildEmptyAtPathPatch` now takes the module source, which is what it needs to
  make that check. This is a breaking change to that internal helper's
  signature.
- `describeContainerAtPath` now reports whether a path was missing or merely not
  a container, so callers can tell "go and look for this path" from "the path is
  right, its type is not".
