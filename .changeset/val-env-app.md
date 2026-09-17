---
"@valbuild/server": minor
---

`VAL_ENV=app` now means the same as `VAL_MODE=memory`: the host is expected to
supply its own `sourceFiles`, and is told so here rather than failing two layers
down in `fs` mode with an `EPERM` on a lock file.

A host knows WHERE it is running. Which Val mode that implies is Val's to
derive, and only the first of those stays true when Val's internals move — so an
environment with no disk can say what it is instead of asserting something about
Val. An explicit `VAL_MODE` still wins, including when it is a typo that has to
be refused.
