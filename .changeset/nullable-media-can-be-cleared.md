---
"@valbuild/ui": patch
---

Fix a nullable image or file that could be filled in but never emptied.

`s.image(gallery).nullable()` had two ways to go wrong, and between them an
editor who added a cover image was stuck with one:

- The tick box a nullable field is given decided which way a click went by
  looking at the source alone. A media field has a third state — no file yet,
  but the field shown, because a media value without a file is not something
  that can be written — and that state looked exactly like "off", so a field
  turned on and then off again re-ran the turn-on branch. The box stayed
  ticked and the image stayed.
- That tick box is only drawn for a field inside an object. An image opened on
  its own — an array item, a record entry, a module whose root is the image —
  had nothing that wrote `null` at all, and a gallery-backed field could be
  pointed at a different entry but never at none.

The field itself now offers **Remove** whenever the schema allows `null` and
there is a file to remove, so it works on every surface, and the tick box
decides on what it shows rather than on the source.
