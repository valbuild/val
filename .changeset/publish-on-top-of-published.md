---
"@valbuild/server": patch
---

Publishing again before the site has redeployed no longer reverts what the previous publish changed in the same file.

A publish now starts from the text that was last published, not from the text the running build was made from. Before, on a project connected to a repository, two publishes into the same `.val.ts` with no deploy in between produced a second commit that silently undid the first one's change. Val still lets you publish while a deployment is pending.
