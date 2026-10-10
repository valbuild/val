---
"@valbuild/cli": minor
---

`val publish` now runs `val validate` first, and does not publish content that
has validation errors.

A connected project's CI publishes with `val publish`, so from this release a
push whose content does not validate fails its run instead of going live. The
run prints the same report `val validate` does. To fix it, run
`val validate --fix` in the project, commit what it changes, push, and fix by
hand whatever it reports that it cannot fix.

The check never fixes anything itself — CI does not rewrite what it was asked
to publish. `--skip-validation` publishes without it.
