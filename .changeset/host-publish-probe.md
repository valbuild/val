---
"@valbuild/tanstack": patch
---

A probe for the seams a host that BUILDS rather than deploys depends on.

`examples/tanstack/scripts/hostPublishProbe.ts` configures both halves of Val in
`http` mode and drives a publish through `publishOverride`, against
`e2e/mock-content-host`. Nothing exercised those two together: `e2e/http/` drives
the Studio, and `publishOverride` has no UI to drive it from.

What it pins is the ordering. A host whose publish is a build must commit
_first_ — building first hands its builder content the content service does not
have yet, so every read in the new build resolves the commit from before the
save, and the site shows pre-save content with the edits already consumed, with
nothing failing to say so.

No product code changed.
