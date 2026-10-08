---
"@valbuild/server": patch
---

Fix: a draft preview could miss a change its editor had just saved. Draft pages scoped to your own changes worked out which pending changes are yours from a list of patch groups remembered for a second, so a save followed by a reload inside that second rendered without the save. The draft page now takes your changes from the same answer as the changes themselves, and any save, discard, stage or unstage through the server forgets the remembered list.
