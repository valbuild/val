---
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/react": patch
"@valbuild/tanstack": patch
"@valbuild/next": patch
"@valbuild/mcp": patch
---

**A visitor leaving a slow page no longer breaks the next request on Cloudflare-style hosting.** On a host that runs the site in a workerd isolate (Val's hosting, Cloudflare Workers), a request could fail at once with "This promise was created by a request that has since ended, so it can never settle." Val's readers are made once per process, and several things they read were cached as a promise that the first request to ask made: the readers' runtime, the draft's chain of edits, a `.jsonValues()` entry's import, the API's and MCP's server. When that first request ended before its read finished -- the visitor closed the tab -- every other request waiting on the same read failed with it, or showed an editor the published page instead of the draft.

The same thing made the Studio's `/stat` say the content service could not be reached (a 503) when nothing had been asked of it at all.

What is cached between requests is now the value a read settled to, never a read still under way, and a read that failed is tried again by the next request rather than kept. A read of the content service that workerd refuses as another request's is made again, and if it is refused again `/stat` answers it as Val's own failure rather than as an unreachable service. Nothing changes in how you call `initValContent`, `initValRsc`, `initValServer` or `initValMcp`.
