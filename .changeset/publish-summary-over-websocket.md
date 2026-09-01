---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
---

Commit summaries now come from the AI chat pipeline instead of a REST endpoint,
and Claude models are selectable.

The publish flow opens its own hidden chat session per publish and pushes the
changed fields — with their previous and new values — as the prompt. It used to
send every changed source file twice for a server-side text diff, so fixing one
typo in a large module uploaded that whole module twice.

Closing the popover or publishing early now cancels the request, which stops it
on the server rather than only stopping the client listening — this matters
because the call runs on your own API key.

`/ai/initialize` reports which models the project can reach, so the Studio picks
one that the configured keys actually allow rather than assuming.

Removes `getCommitSummary` from `ValOps` / `ValOpsFS` / `ValOpsHttp`, the
`/commit-summary` route, and the dead `getCommitMessage` on `ValOpsHttp`.
