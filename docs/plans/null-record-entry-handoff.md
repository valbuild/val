# Handoff: a `null` entry in a declared-key record breaks the Studio

## The task

In the Val Studio, a record entry whose value is `null` renders as a broken
object — every field of the item schema shows "Not Found" — instead of as
"nothing here yet, create it". Fix that, and fix the two related defects below.

Repo: `valbuild/val`. Branch: `claude/i18n-locale-field-02gofr` (PR #608).
Read `.claude/CLAUDE.md` first; its rules bind (no `as any`, no
`@ts-expect-error`, ask before type assertions, never fix a failure by editing
the test).

## Reproduce

```bash
cd examples/next && pnpm dev     # Studio at http://localhost:3456/val
```

Open:

```
http://localhost:3456/val/~/content/translated.val.ts?p=%22announcements%22.%22nb-NO%22
```

`examples/next/content/translated.val.ts` declares

```ts
s.object({
  announcements: s.record(s.locale(), s.object({ title: s.string(), body: s.richtext(...) })),
  posts: s.array(postSchema),
})
```

with source `announcements: { "en-US": {...}, "nb-NO": null }`.

Observed: the entry page renders the item schema's fields, and each one says

> **Title** — Not Found. The path `/content/translated.val.ts?p="announcements"."nb-NO"."title"` can no longer be found.

Expected: one "not written yet" state for the whole entry, with a way to create
it — never a list of broken children.

The record list view also shows the `nb-NO` row as blank rather than as
untranslated. Same underlying cause; fix both.

## This is NOT locale-specific, and NOT about arrays

`null` entries come from the **declared key set** rule this PR introduced: when
a record's key schema enumerates its keys (`s.locale()`, or a union of
literals), the record must hold _every_ key, and an entry nobody has written is
`null` rather than absent. `RecordSrcOf` widens the value type by `null`
accordingly. So this reproduces just as well with

```ts
s.record(
  s.union(s.literal("a"), s.literal("b")),
  s.object({ title: s.string() }),
);
// source: { a: { title: "x" }, b: null }
```

Arrays are not affected — array items are not widened by `null`.

## What is already verified (do not re-derive)

**1. The Studio's source store is correct.** `resolveAtModulePath` in
`packages/ui/spa/stores/SourceStore.ts` (~line 2447) walks
`announcements.nb-NO.title`, hits `current === null` at the last segment and
returns `{ status: "absent" }`. That is the right answer: `.title` genuinely
does not exist. Reading `announcements.nb-NO` itself correctly returns
`{ status: "found", value: null }`.

So **the bug is in the render layer**: something renders the item schema's
children for an entry whose source is `null`, without checking the source
first. Find that component. Note that the ordinary field path already handles
this — `packages/ui/spa/components/Field.tsx:141` gates the null/create toggle
on `(isNullable || source === null)`, and `useFieldState.ts:69` sets
`isNullable = schema?.opt === true`. The navigated-entry page is not going
through that guard. Start there and at whatever renders a navigated object path
(`Module.tsx`, `AnyField`, the canvas field renderer).

**2. `resolvePath` has a separate, real falsiness bug.**
`packages/core/src/module.ts`, in the `isRecordSchema` branch (~line 314):

```ts
if (!resolvedSource[part]) {
  throw Error(`Invalid path: record source did not have key ${part} ...`);
}
```

It tests falsiness, not presence, so a key that exists with a falsy value is
reported as missing. Verified:

```
."en-US"            => OK   {"title":"Jacket"}
."nb-NO"            => THREW  Invalid path: record source did not have key nb-NO
."nb-NO"."title"    => THREW  Invalid path: record source did not have key nb-NO
```

and, with no locales involved at all, `s.record(s.string(), s.string())` with
source `{ empty: "" }`:

```
."empty"            => THREW  Invalid path: record source did not have key empty
```

So this predates the locale work and also breaks `""`, `0` and `false` entries
in any record. The fix is presence, not truthiness (`!(part in resolvedSource)`),
but check what callers expect for a genuinely absent key before changing it, and
add a test for the falsy-but-present cases.

## The design decision you need to make

Where should "an entry of a declared-key record may be `null`" live? The type
system already says it (`RecordSrcOf` widens by `null`); the runtime does not
tell the renderer.

- **Option A — say it in the serialized schema.** Have
  `RecordSchema.executeSerialize()` emit `item` with `opt: true` when
  `declaredKeySetOf(key) !== null`. One source of truth, and every consumer —
  Studio rendering, the zod mirror, `emptyOf`, MCP — inherits it, including the
  existing nullable affordance with no UI change at all. Bigger blast radius:
  check `packages/shared/src/internal/zod/SerializedSchema.ts` and the
  `droppedKeys` round-trip suite, and check that `RecordSchema.executeValidate`
  still skips null entries rather than double-reporting (see
  `packages/core/src/schema/declaredKeys.test.ts`, "null is an entry, not a
  value of the wrong type").
- **Option B — handle it in the UI.** Special-case a null entry where the
  entry is rendered. Smaller and safer, but it puts the declared-key rule in a
  second place, and the rule already has a habit of being re-derived.

**Recommendation: A**, with B as the fallback if A disturbs validation. A is
the version where the renderer needs no new knowledge.

## On the affordance itself

A generic null/create toggle is the existing behaviour and is the right
baseline — reuse `Field`'s, do not invent a control. But consider the wording
for a locale-keyed record specifically: the entry is not "null", it is **not
translated yet**, and that is the state the whole design exists to make
visible. "Not translated — write it" reads better than an empty checkbox, and
the record list row should say the same rather than rendering blank.

Check `useEmptyOf` is used to build the created value, so a new entry gets the
project's locales where it needs them (`packages/ui/spa/hooks/useEmptyOf.ts`).

## Definition of done

- Navigating to a null entry shows one create/untranslated state, no "Not
  Found" children; creating it writes a valid entry.
- The record list row for a null entry reads as untranslated, not blank.
- `resolvePath` resolves present-but-falsy record entries, with a test covering
  `null`, `""`, `0` and `false`.
- A test pins the null-entry render (there is precedent in
  `packages/ui/spa/components/fields/` for rendering tests).
- Full CI green from the repo root:
  `pnpm run lint`, `pnpm -w run format`, `pnpm run -r typecheck`, `pnpm test`,
  `pnpm run build` (then **`pnpm preconstruct dev`**), and
  `cd examples/next && pnpm run build`.

Note: if `examples/next` reports that `s.locale()` or `locales` does not exist,
the tree is in preconstruct _build_ mode against stale `dist/declarations/` —
run `pnpm preconstruct dev` from the root. It is not a code error.
