---
"@valbuild/server": patch
"@valbuild/tanstack": patch
"@valbuild/tanstack-build": patch
---

Groundwork for proposals on the Val platform: a server can be told it is running at a proposal's address (`proposal` in the http options, `proposalFromEnv` to read it from the platform). There, the content the proposal has saved replaces the bundled content for those modules on every read, edits go to the proposal's branch, and Save commits to the proposal instead of the site. Nothing changes for a site that is not given a proposal.
