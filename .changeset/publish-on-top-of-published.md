---
"@valbuild/server": patch
---

Publishing again before the site has redeployed no longer reverts what the previous publish changed in the same file.

A publish now renders its changes on top of everything published since the running build was made, not on top of the build's own text. Before, two publishes into the same `.val.ts` with no deploy in between produced a second commit that silently undid the first one's change. Val still lets you publish while a deployment is pending.
