---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
"@valbuild/server": minor
---

A record whose schema declares its keys now holds every one of them.

Two key schemas enumerate their keys: `s.locale()`, whose set is the project's
`locales.available`, and a union of literals. For those, the keys are part of the
schema, so a missing one is a hole in the content rather than content nobody has
written yet — and validation now says so, naming what is missing.

```typescript
s.record(s.locale(), s.object({ title: s.string() }));
// Missing key: 'nb-NO'. This record's keys are declared by its schema, so
// every one of them is an entry — an entry nobody has written yet is null,
// not absent.
```

**An entry nobody has written yet is `null`.** Not an absent key: a null entry is
data you can count, filter and see in a diff, and it means half-translated
content stays _valid_ rather than blocking a publish. The value type of such a
record widens by `null` to match, so writing one in a `.val.ts` type-checks:

```typescript
c.define(
  "/content/jacket.val.ts",
  s.record(s.locale(), s.object({ title: s.string() })),
  {
    "en-US": { title: "Winter jacket" },
    "nb-NO": null, // nobody has translated this yet
  },
);
```

**This changes `s.record(s.union(...), item)`**, and closes a gap that was
already there: `s.record(s.union(s.literal("a"), s.literal("b")), item)` types as
`Record<"a" | "b", T>`, so TypeScript demanded both keys while the validator only
checked the ones present. It now checks them too, and — as above — accepts `null`
for an entry that has not been filled in. If you have such a record with keys
missing, validation will report them; adding the keys with `null` values is the
fix, and creating one from the Studio does it for you.

`emptyOf` creates these records with every key already in them rather than
empty, since an empty one is already missing keys. In the Studio use the
`useEmptyOf()` hook rather than importing `emptyOf` directly: a locale record's
keys are in the settings module, and the hook is what has read it.
