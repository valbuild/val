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

One behaviour change falls out of the split: a value that is not a string at
all now fails an enum's validation with a type error. `s.union` of literals only
ever checked the value against its literals when the value WAS a string, so a
number or an object where an enum was declared validated clean.

If you read serialized schemas yourself, that is the breaking part: `type` is no
longer `"union"`, an enum carries `values: string[]` instead of a `key` plus
`items` of literal schemas, and `UnionSchema` is no longer a class.
`SerializedUnionSchema`, `SerializedStringUnionSchema`,
`SerializedObjectUnionSchema` and `UnionSchema` remain as deprecated type
aliases.
