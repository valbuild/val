---
"@valbuild/core": minor
"@valbuild/react": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
---

`s.code()` is a schema type, and a multi-line string is `s.string().multiline()`

The two string-only `render` variants are gone. Neither was about layout:
whether a string may hold line breaks is a fact about the content, and a
language is part of what the value is.

```ts
s.string().multiline(); // was .render({ as: "textarea" })
s.code({ language: "typescript" }); // was .render({ as: "code", language })
```

**Breaking:** `s.string().render({ as: "textarea" })` and
`s.string().render({ as: "code", language })` no longer type-check. `.render(...)`
now takes only `{ as: "inline" }`, on every field alike, and `StringRender` is no
longer exported from `@valbuild/core` (`FieldRender` is the one render type).

**`s.string().multiline()`** is a growing text box instead of a single-line
input. It is a property of the serialized schema (`multiline: true`) rather than
a render, read the same synchronous way where the field is drawn, and it
survives chaining (`nullable`, `readonly`, `hidden`, `describe`, `validate`,
`raw`, `minLength`, …) and a serialize → deserialize round trip.

**`s.code(options?)`** is a new schema type, backed by a plain string and edited
in a code editor:

```ts
s.code(); // a monospaced editor, no highlighting
s.code({ language: "json" }); // syntax highlighted
```

`language` is optional and is the same `CodeLanguage` list as before, now
exported from `@valbuild/core` alongside `CodeSchema`, `SerializedCodeSchema` and
`CodeOptions`. The language decides highlighting only — content is never checked
against it, since a half-written snippet is a normal thing to save.

Being its own type is what lets a code value opt out of **stega encoding**: the
invisible characters that carry the edit tag are an edit tag in prose and
corruption in source code, so `s.code()` values now reach your app exactly as
written. A `s.string().render({ as: "code" })` value did not.
