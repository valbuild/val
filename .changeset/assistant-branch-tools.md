---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
---

The Studio's assistant can now tell you where your work goes and whether it can be published:

- **Where am I** — which branch the Studio is on, which branch the site publishes to, and which proposal the work is in.
- **Proposals** — every proposal, including ones that were published or closed, with its branch and status.
- **Branches** — the site's branch and each proposal's, with its last commit and the proposal attached to it.
- **Build checks** — whether a proposal can be published, what failed, and what clears it.

These only read. Code changes still go into a proposal, as before; the assistant does not push to a branch directly. In local development the assistant says plainly that there are no branches or proposals there.

`/stat` now reports `siteBranch`: the branch the site publishes to, in a proposal too.
