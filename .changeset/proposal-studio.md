---
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

Proposals in the Studio, for projects on the Val platform that have them turned on: a switcher in the top bar to move between the site and its proposals, New proposal, Rename, Close and All proposals (with Reopen), and — inside a proposal — Save where Publish is, in the proposal's colour. Nothing is shown for a project without proposals. At a proposal's address the server now refuses to publish to the site, so a Save there can never start a site build.
