---
"@valbuild/server": patch
---

**Edits to fields the design tab added no longer revert.** When the design tab added something to a `.val.ts` in a proposal, such as a new button, the module's code changed but the content the proposal served for it did not. An edit to the new button showed on the canvas and then went back. A staged module file now goes to Val Build with the content its text declares, so the two stay in step. This needs the matching Val Build update.
