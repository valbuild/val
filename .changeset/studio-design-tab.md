---
"@valbuild/server": patch
"@valbuild/ui": patch
---

The design tab: a proposal's code, changed with the assistant, in a tab of its own. Open it from a proposal's menu in the switcher ("Open design tab"). It opens at `/val/design/<proposal>` on the site's address, beside the proposal's, and shows the files the proposal changes against the site, each one's diff, the proposal's history, Build, and the proposal's address in a frame at desktop, tablet and phone widths. The assistant there changes the proposal's code (and only reads content).

The tab is served by the site's build, not the proposal's. So a change the assistant breaks the proposal with takes away the preview, never the tab or the tools that fix it. For that, the site's Val server now stages files in, and builds, a proposal it names; a proposal's address still writes only its own.
