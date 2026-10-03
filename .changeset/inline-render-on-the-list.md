---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
---

**Breaking:** `.render({ as: "inline" })` now goes on the list, not on its items.

You now write `s.array(item).render({ as: "inline" })` and `s.record(item).render({ as: "inline" })`. Each item is then edited in its own row instead of in a preview row you click into. The list decides. The item schema stays reusable, and a page builder made of tagged blocks needs nothing on each block:

```ts
// before
s.array(
  s.discriminatedUnion(
    "type",
    hero.render({ as: "inline" }),
    text.render({ as: "inline" }),
  ),
);

// after
s.array(s.discriminatedUnion("type", hero, text)).render({ as: "inline" });
```

What changed:

- Only `s.array()`, `s.record()` and `s.keyOf()` have `.render(...)` now. On every other schema the method is gone, so the old placement shows up as a type error. Move the render out one level.
- The render only affects the list's own items. A list nested inside one of those items keeps its default unless it has its own `.render`.
- `s.router()`, `s.imageset()` and `s.fileset()` throw if you give them a render, because pages and media have their own editors.
- `s.keyOf(...).render({ as: "inline" })` means the same as before: the selected entry's content is shown below the dropdown.

**Watch for one case that still compiles:** an array or record that is itself the item of another list. `s.record(s.array(s.string()).render({ as: "inline" }))` used to show the record's arrays inline. Now it shows each array's strings inline. To keep the old layout, write `s.record(s.array(s.string())).render({ as: "inline" })`.
