---
"@valbuild/ui": patch
---

Studio: a publish now reaches a resting state in the deploy feed.

The status bar's deploy feed had no way to finish. A publish enters it as the
commit Val just made, which `mergeCommitsAndDeployments` labels `created` —
"Queued" — and only a `success` deployment relayed from the build host could move
it on. Where those events do not arrive, every publish stayed at "Queued"
indefinitely, long after the site had gone out.

Val's own answer to "has this gone out" is `/stat`'s `commitSha`: the commit the
site is actually serving. That now settles a row on its own, whatever the build
host said or did not say, and four things that kept it from being usable are
fixed:

- `/stat` was only re-asked every twenty minutes once the WebSocket was up, so
  the served commit could be twenty minutes stale. It is now asked within seconds
  of a publish, backing off towards the idle interval as a build runs.
- A publish the site was serving still read as "Queued" or "Building" unless a
  green build had also been reported.
- The merge that feeds the feed was re-run only when the NUMBER of deployments
  changed, so a build moving from pending to success — the same row with a new
  state, which is what a `/stat` poll returns — changed nothing on screen.
- Several deployments for one commit were folded newest-first, so a finished
  build was overwritten by the pending one it replaced.

The same scheduling fix removes a wasted publish round trip. The wait after a
WebSocket message was computed as the time already elapsed rather than the time
remaining, so every patch message re-asked `/stat` almost immediately; a publish
racing one of those came back `refused: chain-moved` and had to be retried. The
Studio retried it for you, so this was invisible apart from the extra commit
attempt.
