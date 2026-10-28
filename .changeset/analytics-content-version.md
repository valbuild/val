---
"@valbuild/tanstack": patch
---

Content analytics now counts the visitors of a hosted site that has published content without a build. Such a site serves its content as a snapshot, and the analytics script took any snapshot for a proposal's address and never started, so those sites counted nothing even though their content was tagged.
