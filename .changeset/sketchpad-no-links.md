---
"@valbuild/ui": patch
"@valbuild/shared": patch
---

The Sketchpad's linked text is gone, and so are its "needs code" badges.

- **Linked text is removed.** A heading or paragraph can no longer be linked to a content field (`{field: …}`), and typing in a sketchpad never changes the site's content: the sketch is a plan, and **Build** is what changes the pages. A sketch that still has a `{field: …}` from 0.152.0 shows it as plain text, and can be deleted.
- **No "needs code" badges.** A box of a kind the site does not have, and a new route the site has no page type for, are no longer marked. A box's kind still suggests the site's own kinds.
- **Narrow columns keep their shape.** In a row of several columns, a box's header stays on one line (a long kind is cut short, and shown in full on hover), and a box naming an image the project does not have says so in a few lines, with the file's name on one, instead of breaking the path over many.
