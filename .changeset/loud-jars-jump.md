---
"@valbuild/ui": patch
---

`Finish publishing` — a way out of `Saved, not yet live`, on the row that names the commit that is stuck.

A managed project has nobody else to build it, so a commit whose build never ran stays that way forever: a browser closed mid-publish, a failed build, a builder that could not load. The action is the same pipeline as a publish with the gate and the commit skipped.

It is offered per row rather than as one button, because a project can be stuck at more than one commit and a single button could only ever mean one of them.
