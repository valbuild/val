---
"@valbuild/server": patch
"@valbuild/ui": patch
---

Publishing a proposal is no longer blocked by other people's unpublished changes
on the same pages. When Publish is pressed in a proposal, Val works out which of
those changes conflict with it: those move into a new proposal, named "Moved when
“…” was published", which the people who wrote them own together; the rest stay
unpublished on the site, where they were. The Publish dialog says beforehand how
many changes will move and whose they are.

If someone changes those pages while the proposal is being published, the
publish stops and asks you to press Publish again, so nothing moves on an
outdated plan.
