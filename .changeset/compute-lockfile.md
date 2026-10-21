---
"@valbuild/ui": patch
"@valbuild/server": patch
---

When a proposal changes its dependencies without a lockfile to match, its Build button now reads **Compute lockfile** and computes it. Afterwards, the button shows the proposal's dependencies being built, or says why they could not be built.
