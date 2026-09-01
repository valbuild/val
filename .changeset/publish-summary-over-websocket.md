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

The model catalog now lives in the Studio rather than on the content server, so
offering a newly released model is an editor change and nothing else. An agent
sends `{ provider, model }`; the server checks the provider and passes the model
id to that provider's SDK untouched. `/ai/initialize` reports which providers the
project's keys can reach, and the Studio picks the first model in its catalog
whose provider is among them.

Removes `getCommitSummary` from `ValOps` / `ValOpsFS` / `ValOpsHttp`, the
`/commit-summary` route, and the dead `getCommitMessage` on `ValOpsHttp`.
