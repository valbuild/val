---
"@valbuild/server": minor
---

`VAL_ENV=app` selects `http` mode.

A host knows WHERE it is running; which Val mode that implies is Val's to
derive. `VAL_ENV=app` says "this is the Val app" — a project built in a browser
and served from a Worker isolate — and Val reads that as http mode: there is no
disk, so `fs` is never the right fall-through, and the content is Val's own,
read over HTTP at a commit like any other deployed app.

Unlike `VAL_MODE=memory`, this **selects** the mode rather than only refusing a
fall-through, because everything http mode needs is an environment variable. The
point is what happens when one is missing: inference reads an absent
`VAL_API_KEY` as "not a proxy" and resolves `fs` mode, which in an isolate fails
on `.val/patches.lock` — a path, two layers below the actual mistake. Now each
of `VAL_API_KEY`, `VAL_SECRET`, `VAL_PROJECT`, `VAL_GIT_COMMIT` and
`VAL_GIT_BRANCH` is named when it is the one that is not set, and the message
says which variable put the app in http mode.

An explicit `VAL_MODE` still wins, including when it is a typo that has to be
refused, and `http` is still not a value `VAL_MODE` accepts. A host that passes
`sourceFiles` still gets memory mode: that is checked before the environment is
consulted at all, so a build published by an older platform keeps working.
