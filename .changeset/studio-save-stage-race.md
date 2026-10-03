---
"@valbuild/ui": patch
---

Staging or unstaging a change while the Studio is still saving an edit no longer gets undone by that save.

Saving an edit also adds it — and whatever it was written on top of — to your staged changes, and the server applies a save and a stage/unstage in whatever order they arrive. Unstage something while an edit on top of it was still being saved, and the save could land second and quietly stage it again; or the edit could end up staged without the change beneath it, which a reload then showed. Now a stage or unstage made during a save is sent once the save has been answered, an unstage takes with it any just-saved edit that depends on what it removes, and what is staged after a reload is what you last chose.
