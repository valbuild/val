---
"@valbuild/ui": patch
---

A long `.jsonValues()` record's list no longer jumps back to the top while you scroll it, and a library entry's "used by" on a large record is about twice as fast.

- **Scrolling a record.** As you scrolled, each set of entries that arrived made the list draw itself again from scratch, which put it back at the top. On a record of 1,000 posts that happened every few screens. The list now stays where you are while entries load.
- **"Used by" and validation errors.** Every part of the Studio that shows a count or a list of validation errors (the Publish button, the menu's error badges, the gallery and others) worked out the whole project's errors on its own, each time any module was checked. They now share one answer, and only the module that changed is looked at again. A record whose entries all pick an image from a library is also no longer checked again for each set of entries that arrives, when it has no error to show. On a built Studio with 10,000 posts, "used by" went from 3.5 s with pauses of up to 180 ms to 1.7 s with pauses of up to 90 ms.
- **The gallery's entry panel** opens before it starts looking for where the file is used. Delete and Rename stay unavailable until that look has finished, as before.
