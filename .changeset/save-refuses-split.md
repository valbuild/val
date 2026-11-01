---
"@valbuild/server": patch
---

**A save no longer half-applies an edit.** A save patches a module's file and its content separately. When an edit applied to the file but not to the content, the save went through anyway: the file had the edit, the content didn't, and the edit disappeared soon after. Such a save is now refused, naming the change and why it could not be applied, as a save the file refuses already is.
