---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

History is shown for projects hosted by Val Build and inside a proposal, where it lists the proposal's own saves. On the site of a project with proposals, a restore — one field, one module, or "Put everything back" — opens a new proposal with the restored values in it, so it is reviewed there before it is published.

History also reads a hosted project's first commit, which has no parent: "Go back to this point" failed on it.

"Go back to this point" on the site brings back the code as well as the content: the proposal it opens stages the files of the build the site served then, and serves that build at once.
