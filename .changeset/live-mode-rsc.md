---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/server": minor
"@valbuild/next": minor
---

Add live mode: render content that has been saved in Val but is not yet deployed.

Until now an app rendered exactly what was compiled into the deploy. When an editor hit **Save**, the change was committed — but nobody saw it until CI had rebuilt and redeployed. On a large site that is minutes; if the deploy pipeline is broken, it is never.

Live mode is an opt-in config flag that closes that gap for _everyone_, with no login and no cookie:

```ts
const { s, c, val, config } = initVal({
  project: "myteam/myproject",
  gitBranch: process.env.VERCEL_GIT_COMMIT_REF,
  gitCommit: process.env.VERCEL_GIT_COMMIT_SHA,
  live: { ttl: 60, staleWhileRevalidate: 300 },
});
```

`ttl` is required (0 is allowed, meaning always refetch), since live mode has to ask Val what changed on every render unless we cache. `VAL_LIVE_TTL`, `VAL_LIVE_STALE_WHILE_REVALIDATE` and `VAL_LIVE_DISABLED=true` override it per environment. Live mode requires remote mode; in local development it warns and does nothing.

This release covers the server-rendered surfaces: `fetchVal`, `fetchValRoute` and `fetchValRouteUrl` resolve live content, so the HTML is already correct on a hard load — including for a route that only exists in a committed patch, and for images added by one. Client Components (`useVal`) still render the build-time content; support is coming.

Val is never in the critical path for correctness. A slow, unreachable or unexpected response falls back to the last good patch set, and failing that to the deployed content — it never throws and never 500s a page. Live content is public content, so `data-val-path` editing markers stay bound to draft mode and are never emitted for it.

Also enables the immutable `Cache-Control` on `/api/val/files` for the `patch_id` branch, which was previously commented out: those responses are content-addressed, and live mode makes that route considerably hotter.
