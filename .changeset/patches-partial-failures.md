---
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

Two answers from `/api/val/patches` no longer tell the Studio something false when the content service behind it fails part of the way.

- **Discarding a change while the content service is down no longer looks like it worked.** If the content service answered with an error or could not be reached, `DELETE /api/val/patches` answered 200 with every patch as deleted. The Studio then forgot changes that still existed: a reload brought them back, and the next publish could ship a change you had discarded. It now answers 502 with the content service's reason, and the Studio keeps the change and says the discard failed.
- **An edit made while someone else is editing is no longer stuck unsaved.** A batch of edits is saved one patch at a time, so another editor's change can land between two of yours. When it did, the server answered the conflict without saying the first patch had been saved, the Studio sent that patch again, and the content service refused it as one it already had. The save then retried forever and the edit after it was never saved. The conflict now names what was saved, as the other partial failures already did, and the Studio sends only the rest.
