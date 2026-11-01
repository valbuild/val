---
"@valbuild/ui": patch
---

Cards in an array or record list stay inside the editor and stay short.

- A long value — a paragraph, a URL, a long key — is cut off with "…"
  instead of widening the card, so the menu on the right of each row is no
  longer pushed out of view.
- An item without a `.preview()` shows at most four lines, the last saying
  how many fields were left out, instead of every one of its fields.
- A field that is itself an object reads on one line —
  `Author  Name Fredrik · Email fredrik@example.com · Role Developer` —
  instead of a field list nested inside the card.

A `.preview()` on the item is still the way to choose exactly what a row shows.
