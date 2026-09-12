---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
"@valbuild/react": minor
"@valbuild/server": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
"@valbuild/cli": patch
"@valbuild/init": patch
---

`s.union` is now `s.discriminatedUnion` and `s.enum`.

`s.union` did two unrelated jobs and worked out which one you meant from its
first argument: a string key meant a tagged union of objects, literal schemas
meant a set of allowed strings. Those are now two schemas with two names.

```ts
// A fixed set of strings — presents as a dropdown
s.enum("primary", "secondary", "ghost"); // Schema<"primary" | "secondary" | "ghost">

// One of several object shapes, told apart by a tag field
s.discriminatedUnion(
  "type",
  s.object({ type: s.literal("hero"), heading: s.string() }),
  s.object({ type: s.literal("quote"), text: s.string() }),
);
```

`s.enum` takes the strings directly, so the `s.literal(...)` wrapper is gone.

**`s.union` still works** — it is deprecated, and it builds exactly the schema
above, so nothing has to change today:

```ts
s.union(s.literal("one"), s.literal("two")); // → s.enum("one", "two")
s.union("type", pageA, pageB); // → s.discriminatedUnion("type", pageA, pageB)
```

The two are different kinds of node, and that is the reason for the split. A
discriminated union is a container: the selected variant's fields are the fields
being edited, and everything that walks a schema descends through it. An enum is
a leaf — a string with a closed domain — so nothing recurses into it. Told apart
only by the shape of `key`, every consumer had to re-derive which one it was
holding; each now has its own serialized type (`"discriminated-union"` and
`"enum"`) and Val Studio has a field per kind rather than one field that
branches.

Two behaviour changes fall out of the split, both of them fixes:

- A value that is not a string at all now fails an enum's validation with a
  type error. `s.union` of literals only ever checked the value against its
  literals when the value WAS a string, so a number or an object where an enum
  was declared validated clean.
- An enum field now shows its validation errors in Val Studio where the field
  is opened on its own — the module editor and the canvas's fields column — and
  gets the compact error layout inside an inline list row. It is a leaf now, so
  it goes through the same error rendering as every other leaf field; the string
  union bypassed it and showed nothing in those places.

Several latent crashes in the old `s.union` are fixed on the way past, all of
them cases where it threw a `TypeError` instead of reporting:

- A required discriminated union holding `null` now reports a type error rather
  than throwing, and resolving a path underneath a nullable one that is `null`
  gives the error the API promises instead of a crash.
- `s.literal("")` is a legal discriminator tag, and `s.enum("")` a legal value.
  Both used to be treated as absent by a truthiness check — in path resolution,
  in stega encoding, and in the message that lists a union's valid tags. The
  editor's dropdowns handle them too: an empty value is reserved by the select
  component and had to be mapped around.
- A variant that omits the discriminator entirely is now reported as the schema
  error it is, instead of throwing while the check looked for it.
- An enum's value is now indexed for search, like every other string leaf. The
  old string union was never indexed at all, so searching for one of its values
  could not find the field.
- A nullable discriminated union set to `null` no longer renders a spinner that
  never resolves.

`s.discriminatedUnion` also requires at least one variant, as `s.enum` requires
at least one value: a union with nothing to select is not a thing to write, and
everything downstream reads the first variant where it needs any.

If you read serialized schemas yourself, that is the breaking part: `type` is no
longer `"union"`, an enum carries `values: string[]` instead of a `key` plus
`items` of literal schemas, and `UnionSchema` is no longer a class.
`SerializedUnionSchema`, `SerializedStringUnionSchema`,
`SerializedObjectUnionSchema` and `UnionSchema` remain as deprecated type
aliases.
