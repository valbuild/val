# Val Codebase Instructions

Instructions for AI assistants working with the Val content management system codebase.

## Read first

[`architecture/`](../architecture/README.md) holds the explanations that are
expensive to re-derive from the code:

- [`architecture/stores.md`](../architecture/stores.md) — the Studio's client
  state in one page: marks vs demand, the two realms, `peek`/`get`, and why
  reference stability is load-bearing.
- [`architecture/media.md`](../architecture/media.md) — `s.imageset()` / `s.fileset()`
  vs `s.image()` / `s.file()`, where uploaded bytes land, and how a file's URL is
  chosen (the rule that has been got wrong repeatedly).
- [`architecture/patch-store.md`](../architecture/patch-store.md) — where
  unpublished edits live in local dev: the ordering log, the lock, and the
  incident that decided the layout. **Read this before touching `ValOpsFS` or
  anything under `.val/patches`.**
- [`architecture/quirks.md`](../architecture/quirks.md) — true, surprising things
  that each cost someone an afternoon. **Skim this before debugging the Studio**,
  and add to it when you lose time to something a comment could not have said.

## General rules

1. Never add @ts-expect-error unless explicitly being allowed to do so
2. Never use as any unless explicitly being allowed to do so
3. Ask if you need to use type assertions (`as Something`) - we try to avoid those
4. Prefer annotating the expected return type over `as const`. Widening a
   returned literal with `as const` leaves the contract implicit and re-derived
   at every `return`, so nothing checks that the returns agree or that they
   cover the union the caller narrows on. Annotate the function - or the
   `useMemo<T>` / `useCallback<T>` / variable - with the type it is supposed to
   produce, and drop the `as const`:

   ```typescript
   // ❌ WRONG - the union is whatever the returns happen to add up to
   const res = useMemo(() => {
     if (!data) return { status: "loading" as const };
     return { status: "success" as const, data };
   }, [data]);

   // ✅ CORRECT - the union is declared, and every return is checked against it
   type Result = { status: "loading" } | { status: "success"; data: Data };
   const res = useMemo<Result>(() => {
     if (!data) return { status: "loading" };
     return { status: "success", data };
   }, [data]);
   ```

   An `as const` on a return inside a function that already has a return type
   annotation is pure noise - remove it.

## Type System Architecture

### Core Type Hierarchy

Val has a dual type system: **Source** types define data shape, **Selector** types is the user facing types.

**Source is the data of a module** - JSON, the thing patches apply to. It is not
the `.val.ts` file and not a description of it; a variable holding `.val.ts`
text is text, not Source. See
[`architecture/terminology.md`](../architecture/terminology.md) for that
distinction and the path vocabulary that goes with it.

```
Source (data)          →  Selector (access)
─────────────────────────────────────────────
MediaSource            →  GenericSelector  (`url` is generated at resolve time)
RichTextSource<O>      →  RichTextSelector<O>
SourceObject           →  ObjectSelector<T>
SourceArray            →  ArraySelector<T>
string/number/boolean  →  StringSelector/NumberSelector/BooleanSelector
```

### Key Type Definitions

**Source** (`packages/core/src/source/index.ts`):

```typescript
export type Source =
  | SourcePrimitive // string | number | boolean | null
  | SourceObject // { [key: string]: Source }
  | SourceArray // readonly Source[]
  | MediaSource // { path: string, ...optional }
  | JsonSource
  | RichTextSource<RichTextOptions>;
```

**SelectorSource** (`packages/core/src/selector/index.ts`):

```typescript
export type SelectorSource =
  | SourcePrimitive
  | undefined
  | readonly SelectorSource[]
  | { [key: string]: SelectorSource }
  | MediaSource
  | JsonSource
  | RichTextSource<AllRichTextOptions>
  | GenericSelector<Source>;
```

**GenericSelector** (`packages/core/src/selector/index.ts`):

```typescript
class GenericSelector<T extends Source> {
  [GetSource]: T; // The actual source value
  [GetSchema]: Schema<T> | undefined; // Schema for validation
  [Path]: SourcePath | undefined; // Path in the module tree
  [ValError]: Error | undefined; // Type errors
}
```

### CRITICAL: Adding New Source Types

When adding a new source type, it **MUST** be added to BOTH unions:

1. `Source` in `packages/core/src/source/index.ts`
2. `SelectorSource` in `packages/core/src/selector/index.ts`

Additionally: 3. Create selector type in `packages/core/src/selector/{name}.ts` 4. Add mapping in `Selector<T>` conditional type in `packages/core/src/selector/index.ts`

### FORBIDDEN: Type Intersection Hacks

**NEVER** use type intersections (`&`) to force a type to satisfy constraints:

```typescript
// ❌ WRONG - This is a hack that hides the real problem
export type RichTextSelector<O> = GenericSelector<RichTextSource<O> & Source>;

// ✅ CORRECT - Add missing types to SelectorSource union
export type SelectorSource =
  | ...existing types...
  | MediaSource  // Add missing type here
```

If you see `Type 'X' does not satisfy the constraint 'Source'`, the fix is almost always adding a type to `SelectorSource`, NOT using intersections.

## `describe` vs `preview` vs `render`

**`.describe()` is INPUT HELP and is shown wherever that field — or a record's
key — is being ENTERED; `.preview()` is a NAME and is shown wherever the value
is REFERRED TO rather than edited; `.render()` is LAYOUT and applies only while
the field is open in front of you.**

The test that settles every case: **can the reader change something here?**

| Yes — a description belongs here        | No — a preview belongs here          |
| --------------------------------------- | ------------------------------------ |
| The input beside a field's label        | A list row                           |
| The key box in "New entry" / "New page" | A reference, once it has been chosen |
| "Rename key", "Duplicate entry"         | A search hit                         |
| The key half of a reference dropdown    | A card                               |
| A field open in the overlay             | The heading of what you navigated to |

So a record's `key` schema carries its own description ("The URL of this blog
post. Lower case, no spaces.") and every form that asks for a key shows it —
`AddRecordPopover`, `DuplicateRecordPopover`, `ChangeRecordPopover`,
`NewPageForm`, `KeySelector`. A key description shown where the key cannot be
edited is a bug, not a label.

That asymmetry is why a description is plain data on the serialized schema and a
preview is a closure: a description is true before any value exists and says the
same thing to everyone filling the field in, and a preview cannot exist without
the one value it names. A description must therefore never be used as a
subtitle — it would repeat one sentence under every row of a list — and a
preview must never be used as help text, because there is nothing to preview
until after the value has been entered. None of the three substitutes for
another: a field with a perfect description still previews as `#3` until
someone writes the preview.

### Where a preview comes from

A value's preview reaches it by ONE of two routes, and which one depends on
whether it has a container:

- **Its own `self`** — for a module root, or a field of an object: anything that
  is nobody's row. `executePreview` emits it at the value's own path. Before
  that existed, `.preview()` on a module's own schema was dead code.
- **Its container's `rows`** — for an item of an array or record, reified by the
  container from the ITEM schema's closure. Deliberately NOT also a `self`: it
  is one closure, and array and record pass `selfIsReifiedByParent` to their
  direct items so it runs once per row rather than twice.

`ReifiedPreview` therefore maps a path to `{ self?, rows? }`. Two fields, not a
union, because a path can have both: `s.array(section).preview(...)` where
`section` also previews is a list that shows its rows AND names itself.

Two traps, both of which shipped once:

- **A module's `self` must never reach a path below it.** `PreviewStore` hands a
  row the module-root entry so the row can find itself in that entry's windowed
  `rows`; handing the entry over whole made every author read back the record's
  own title. `asSeenFromBelow` strips `self`.
- **A preview is computed for a module with a LISTENER on it, and no other.**
  `get()` does not count. A nav reads sources without subscribing
  (`useShallowModulesAtPaths` says so), so a nav that NAMES its rows must call
  `usePreviewDemand` — one listener per module, never one per row. Without it
  the titles appear only for the module the editor is currently in, which reads
  as data missing rather than as a feature not used.

### A preview is a TITLE, never a LOCATION

This is the line that decides every surface, and it was got wrong once in each
direction:

- **A title** is what a thing is CALLED, where the thing is shown as a thing:
  the heading of what you opened, a card, a list row, a search hit, a reference
  once it has been chosen. A preview belongs in all of these.
- **A location** is WHERE YOU ARE, and it is made of path segments: the
  breadcrumb under the heading, the Explorer tree, the Pages tree. A preview
  belongs in NONE of these — not even for a module root, not even when it reads
  better.

Two reasons, and the second is the one that settles it:

1. A trail of titles names three things and locates none of them.
   `Content / Forfattere / Theodor René Carlsen` cannot be typed into a URL bar,
   grepped for, or matched against the file an editor is looking at.
2. A preview is a CLOSURE OVER SOURCE, so a title changes as an editor types.
   A location that moves under you is not a location.

The one thing a location may take from the heading is a page's ROUTE, because a
route IS the page's location. And it takes it INSTEAD of the file path, not
beside it: `/app/blogs/[blog]/page.val.ts?p="/blogs/blog2"` reads `/blogs/blog2`
and nothing else, because nobody reaches a page through the file — the Pages
panel is a tree of routes. `scopePartsBelowPageRouter` is that rule.

### `describePath` is the one implementation

`packages/ui/spa/utils/describePath.ts` turns a source path into the
`{ title, subtitle, image, url, pathLabel }` a human is shown — the preview side of the rule, and only that. It prefers the
value's preview and falls back to the route, the key, the index or the file
name, and `origin` says which happened, so a surface can tell a name someone
wrote from a key we had lying around.

Anything that TITLES a path goes through it rather than deriving a name of its
own — the heading, list rows, search hits and references disagreed with each
other before it existed. Anything that LOCATES a path does not go near it: the
breadcrumb and the Explorer use path segments, per the rule above.
`useDescription` is the hook; `useRefPreview` is the rows lookup underneath it
and stays the right call for a list row, which has no `self` to read.

## Schema System

### Schema-Source Relationship

Each Schema class validates and types its corresponding Source type:

| Schema              | Source                                        | Factory               |
| ------------------- | --------------------------------------------- | --------------------- |
| `ImageSchema<T>`    | `ImageSource`                                 | `s.image()`           |
| `FileSchema<T>`     | `FileSource`                                  | `s.file()`            |
|                     | (both are `{path, …}`; see `source/media.ts`) |                       |
| `RichTextSchema<O>` | `RichTextSource<O>`                           | `s.richtext(options)` |
| `ObjectSchema<T>`   | `SourceObject`                                | `s.object({...})`     |
| `ArraySchema<T>`    | `SourceArray`                                 | `s.array(schema)`     |

### Choosing between two shapes: `s.discriminatedUnion` and `s.enum`

These were one schema (`s.union`, still exported and still working, now
deprecated), and splitting them is the whole point: they are not the same kind
of node, and everything that walks a schema tree has to treat them differently.

- **`s.discriminatedUnion(key, ...objects)`** is a CONTAINER. Every variant is
  an object with `key` set to a distinct `s.literal(...)`, the value's tag says
  which variant it is, and the variant's fields are the fields being edited. A
  walk has to descend through the matching variant — and the variants SHARE the
  union's path, which is why `executeCustomValidateAt` and `executePreviewItem`
  dispatch there rather than the caller resolving a child path. Serializes as
  `{ type: "discriminated-union", key, items }`.
- **`s.enum("a", "b")`** is a LEAF — a string with a closed domain, like
  `s.literal` with more than one allowed value. There are no member schemas, so
  nothing recurses into it, and (like a literal) it is NEVER stega encoded:
  consumer code compares against those exact strings. Serializes as
  `{ type: "enum", values }`.

`s.union` dispatches on its first argument (a string key → discriminated union,
literal schemas → enum) and produces exactly those two, byte-identically
serialized. There is no third serialized form and no `UnionSchema` class any
more — `UnionSchema`, `SerializedUnionSchema`, `SerializedStringUnionSchema`
and `SerializedObjectUnionSchema` are deprecated type aliases.

### `s.view()` points at another module; it does not contain one

`s.view(otherVal)` is a field whose source is a POINTER and nothing else:

```typescript
const schema = s.object({ title: s.string(), people: s.view(employeesVal) });
export default c.define("/app/menneskene/page.val.ts", schema, {
  title: "Våre folk",
  people: { view: "/data/employees.val.ts" },
});
```

The module it names keeps its own source, patches, validation and address. In
the editor the field is a ROW that navigates there — it does not render the
target's fields inline — which is also what stops an editor mistaking a shared
module for a field of the page they are on.

Eight things decide how it behaves, and each was a choice:

- **A plain object, not a constructor.** Same rule as media: the value has to
  work in a `.val.ts` and in a `*.val.json`, and a literal survives the static
  extraction (`evaluateExpression`) that a call expression does not.
- **A module carries its own id in its type.** `ValModule<T, Id>`, inferred from
  `c.define`'s first argument, so `s.view(fooVal)` produces a schema whose source
  type is the LITERAL `{ view: "/foo.val.ts" }`. The path autocompletes, and a
  source naming a different module than its schema does is a type error. The
  runtime check in `ValViewSchema.executeValidate` is for hand-written JSON, which
  the compiler never saw.
- **`view` is a reserved object key** (`ObjectSchemaProps`, beside `_type` and
  `patch_id`). An ordinary `s.object({ view: s.string() })` is structurally
  identical to a pointer, and would be mapped to `ValView<T>` and lose every
  field it has — silently.
- **The read side is `ValView<T>`, with no properties.** A new arm in
  `Selector<T>` and in `StegaOfSource`, above `SourceObject` (the marker is structurally an
  object) — the same position and the same reason as the `ExternalRecordSrc`
  arm. Never stega encoded: an edit tag woven into a path corrupts the path.
- **No cycles.** `viewCycles.ts`, called from `extractValModules` next to
  `resolveSettingsModule` and for the same reason: it is a property of the whole
  set of schemas, so no single module can see it. **Nothing else would catch
  it** — a view stores a pointer rather than content, so there is no data cycle
  for a source walk to trip over. A DIAMOND (two paths to one module) is not a
  cycle and is allowed.
- **A module cannot BE a view.** `c.define(path, s.view(x), …)` throws.
- **The exported names carry a `Val` prefix, and this family alone does.**
  `ValView<T>`, `ValViewSource`, `isValViewSource`, `ValViewSchema` and
  `SerializedValViewSchema` — where every other schema is `ImageSchema` /
  `ImageSource` with no prefix. `View` is the name a consuming
  app is most likely to have its own of (React Native's, every design system's,
  the local one in half the projects that would install this), and the rest
  follow it so the family reads as one. It is a deliberate break from the
  convention, not an oversight: do not "fix" it back. The WIRE form is
  untouched — `type: "view"` is the serialized discriminant and renaming it
  would break every stored schema and the zod parser.
- **`hidden` and `readonly` are the view's own, never the target's.** A view
  whose target module is hidden is still shown, and still leads there — which
  is the whole point, because `hidden` on a MODULE's root schema means "the nav
  does not list this", at EVERY destination the menu has: the Explorer and
  Pages (both in `useTrees`, which drops a hidden module before it sorts
  routers from the rest), Media (`collectMediaModules`) and Settings
  (`useNavMenuData`, which resolves the settings module first and drops it
  after — two settings modules must stay an error rather than become a way to
  pick between them). A module has no parent to be hidden from, so it can mean
  nothing else. The pair is what lets `employees.val.ts` be a `keyOf` target a
  dozen modules point into, out of the nav, and reached from the one page it
  belongs to. It also forced `AnyField`'s `ignoreHidden`, set by `Module`
  alone: the page an editor has navigated to is not a parent's field list, so
  honouring `hidden` there renders a blank page instead of hiding a row.
  Hiding a page ROUTER is the sharp edge — its pages leave the sitemap with it,
  so the site's URLs are listed nowhere.

Not built yet, and deliberately: rendering the target inline
(`render({ as: "inline" })`) and resolving a view through `useVal`/`fetchVal`.

## Module System

### c.define() Pattern

```typescript
c.define(
  "/content/page.val.ts",  // Module path
  s.object({...}),          // Schema
  { ... }                   // Source data matching schema
)
```

### Media is a plain object, not a constructor

There is no `c.image` / `c.file` / `c.remote`. Media is written as an object with
a `path`, so the same value works in a `.val.ts` and in a `*.val.json` entry:

```typescript
// s.image()
{ path: "/public/val/logo.png", width: 100, height: 100,
  mimeType: "image/png", alt: "A logo", hotspot: { x: 0.5, y: 0.5 } }

// s.image(galleryVal) — the gallery has the dimensions and mime type
{ path: "/public/img/logo.png" }

// s.file()
{ path: "/public/val/doc.pdf", mimeType: "application/pdf" }

// remote: the same object, with a remote URL in `path`
{ path: "https://remote.val.build/file/p/…/logo.png", width: 100, … }
```

Nothing decides "this is media" by looking at the value — the **schema** does
(`type === "image" | "file"`). See [architecture/media.md](../architecture/media.md).

## UI Architecture

### Shadow DOM Isolation

The Val UI runs inside a Shadow DOM for CSS/JS isolation from the host page:

```typescript
// packages/ui/spa/components/ShadowRoot.tsx
const root = node.attachShadow({ mode: "open" });
// ID: "val-shadow-root"
```

**Implications:**

- CSS must target `:host` (not `:root`) for shadow DOM styles
- External stylesheets must be loaded inside the shadow root
- `document.querySelector` won't find elements inside shadow DOM
- Use `shadowRoot.querySelector` or React refs instead

### CSS Architecture

```css
/* packages/ui/spa/index.css */
@layer base {
  :host,    /* Shadow DOM */
  :root {
    /* Regular DOM fallback */
    --background: ...;
    --foreground: ...;
  }
}
```

- Dark mode: `[data-mode="dark"]` selector
- CSS loaded via `/api/val/static/{VERSION}/spa/index.css`
- Event `val-css-loaded` dispatched when styles are ready

### Tailwind Configuration

```javascript
// packages/ui/tailwind.config.js
darkMode: ["class", '[data-mode="dark"]'];
```

Custom color tokens map to CSS variables (e.g., `bg-background` → `var(--background)`).

## Framework packages

**TanStack Start is the PRIMARY release target.** Next.js is still supported and
still the older of the two bindings, but when the two disagree — about which one
gets a feature first, which one a doc example is written against, which one is
driven by a test — TanStack wins. So a change to `@valbuild/next` that
`@valbuild/tanstack` has not got is unfinished work, not a decision; the
reverse is an ordinary lag.

Two things follow, and they are the ones that get forgotten:

- **`examples/tanstack` is the feature showcase, and it is only useful while it
  is complete.** It exists to be the app where every schema type and every
  schema modifier can be seen working, so ADDING A SCHEMA FEATURE INCLUDES
  ADDING IT THERE — a module (or a field in one), registered in
  `val.modules.ts`, rendered by a route, and passing `val validate`. A feature
  that exists only in `packages/core` is a feature nobody can look at.
  `examples/next` is the FIXTURE app: it carries the awkward shapes the e2e
  suite and the language server drive, and it is allowed to hold things the
  showcase does not.
- **The TanStack checks have no CI job yet**, so they are yours to run. See the
  CI section: `pnpm exec playwright test --project=tanstack` and
  `cd examples/tanstack && pnpm run build`. Neither is optional for a change the
  Studio loads through.

The showcase covers, as of writing: every `s.*` factory except `s.union`
(deprecated); `describe` / `preview` / `render` /
`validate` / `nullable` / `readonly` / `hidden`; `minLength` / `maxLength` /
`min` / `max` / `regexp` / `multiline` on strings and numbers, `from` / `to` on
dates, `include` / `exclude` on routes; `s.record(key, item)` and the
three-argument `s.router(router, key, item)` so a KEY can carry its own
description; `.jsonValues()` with `c.json()`; `tanstackRouter` and
`externalPageRouter`; and the settings sections `locales`, `theme` and
`assistant`. What it does NOT cover, and why: `.remote()` on media and
`.external()` on a record, because both need credentials or an adapter a plain
`pnpm dev` does not have — `examples/next` gates the remote one behind
`NEXT_PUBLIC_VAL_EXAMPLE_REMOTE_MEDIA`. When you add to the list, add to that
sentence too, so the gap stays a decision rather than an oversight.

`@valbuild/next` and `@valbuild/tanstack` are deliberately near-copies of each
other: the provider, the overlay
context, the canvas bridge, the client hooks and the route helpers are the same
code with a different framework underneath. When you change one, ask whether the
other needs it — `packages/tanstack/README.md` has a table of what actually
differs.

What is genuinely different in TanStack Start, and why:

- **There is no RSC.** So there is no `rsc` entrypoint; the server-side readers
  (`fetchVal` and friends) live in `@valbuild/tanstack/server` as
  `initValContent`, and the recommended way to read content is the client hooks,
  which resolve on the server during SSR and in the browser after that.
- **There is no `draftMode()`.** `valDraftMode()` in the tanstack package owns a
  `val_draft_mode` cookie instead. It is a mode switch, not a credential — draft
  reads are still gated by the signed session cookie.
- **A route module is named after its route file.** `src/routes/posts.$postId.tsx`
  is served by `src/routes/posts.$postId.val.ts`. `tanstackRouter` in
  `packages/core/src/router.ts` reads the URL pattern out of that name, and
  `tanStackSegmentsOfRoutePath` is the one implementation of the conventions —
  `@valbuild/shared`'s `getPatternFromModuleFilePath` calls it rather than
  re-deriving them.
- **The Studio UI is router-agnostic.** `isPageRouter` in
  `packages/core/src/getSourcePathFromRoute.ts` is the single answer to "does
  this router's keys name routes of this site"; the sitemap, the Pages menu and
  the add-a-page form all go through it. Adding a third framework means adding
  a parser there, not another special case in the UI.

Several TanStack-specific traps are recorded in
[`architecture/quirks.md`](../architecture/quirks.md) under "TanStack Start" —
read them before debugging a Studio that hydrates and then stops.

## MCP

`@valbuild/mcp` (`packages/mcp`) is Val's content tools for MCP hosts: the tool
registry, the write path behind it, and the request guards and access-token
verification that decide whether a call reaches a tool at all. **Nothing in it
imports an MCP SDK** — the app owns the transport, and the SDK has reorganised
itself once already. `@valbuild/next/server`'s `initValMcp` is a thin binding
that supplies the Next version; `examples/next/app/api/mcp/route.ts` is the
whole of what an app writes.

`upload_image` is the one tool a host has to construct itself:

```ts
initValMcp(valModules, config, {
  extraTools: createValImageTools(sharpImageProcessor(sharp)),
});
```

`sharp` is passed in, never imported — it ships a compiled binary per platform,
and a CMS should not put one in every project that installs it. The processor
is typed structurally (`SharpLike`), so this package typechecks in a project
that has never heard of sharp; `sharpImageProcessor.test.ts` assigns the real
library to that type, which is what stops it drifting.

Remote images (`s.image().remote()`, `s.imageset({...}).remote()`) work too, and
the thing to know is that **nothing is uploaded to the content host when the
image is added**. The bytes go into the patch store like any local pending file;
the push to `remote.val.build` happens at publish, from
`ValOpsFS.saveOrUploadFiles(mode: "upload-remote")`. All the tool does extra is
build the ref — which needs the project's public id and a bucket, from
`getSettings`.

No credential comes from the MCP caller for that, in either mode:
`resolveRemoteFileAuth` (shared with `ValServer`) uses the app's api key where
there is one and otherwise, in fs mode, the developer's own `val login` token
off disk. Same precondition `val validate --fix` has. See
`docs/plans/mcp-remote-images.md`.

Encoding is the Studio's decision table and nothing else: `encode` is off
unless the schema asks, and when it asks, which images are converted, how far
they are scaled and when the original wins are all in
`encodeImageDecisions.ts`. The tool adds no rule of its own.

Four things in there are load-bearing, and the first three were got wrong first:

1. **Bytes go up before the patch is validated.** A `file` op carries a hash,
   so validation asks the store where the bytes are — and rejects the write
   that was about to put them there. `savePatch`'s `uploadFiles` hook returns
   where it put them, and that merges over `fileLastUpdatedByPatchId`.
2. **A gallery-backed field's gallery entry is written first.** `s.image(gallery)`
   validates that the gallery HAS the path, so the field cannot go first. It
   still reports one unresolved error afterwards, because the schema's copy of
   the gallery is snapshotted at module evaluation and shows the _published_
   gallery — that resolves when both patches publish, so it is reported rather
   than refused.
3. **A remote ref's validation hash is computed from a schema that has to
   match what the validator will resolve.** For a gallery entry that is a
   SYNTHESIZED `SerializedImageSchema` carrying the record's `accept` and
   `dir` — `galleryEntryImageSchema`, which must stay identical to
   `handleRemoteGalleryFileUpload`'s. Get it wrong and the file uploads and
   then never validates, silently, because `validateRemoteFiles` is a stub.
4. **`accept` is checked after the conversion, never before it.**
   `s.image({ accept: "image/webp", encode: { type: "webp" } })` means "I store
   webp and I will convert what you give me", so checking the SOURCE against
   `accept` refuses the PNG the conversion existed to handle. The tool checks
   it at all — which the Studio does not — because `ImageSchema` reports a
   mismatch as `image:check-metadata`, and `partitionValidationErrors` treats
   that as server-repairable and therefore non-blocking. The Studio does not
   need the check: its file picker carries `accept`. An agent has no picker.

`search_content` builds its index on every call and throws it away, and the
measurement is why that is allowed rather than a shortcut. Indexing
`valbuild/web` — a real production site, 20 modules and 206 KB of source JSON —
takes **162 ms**; the cost is linear, so 2 MB is ~1.4 s and 10 MB is ~7.9 s, and
the 10 s default deadline is not reached until roughly 13 MB. Searching the
built index is another 0.2 ms, which is why none of those numbers are about
searching. Loading the modules costs _more_ than indexing them (843 ms for the
same 20), and every tool call already pays that in `loadState`. Re-run the
benchmark before believing anything different: `searchIndex.perf.test.ts` in
`@valbuild/shared` guards the linearity, not the stopwatch.

The same ratio is why the tool takes a LIST of queries: everything expensive
happens before the first query runs, so a second query against a built index is
free next to a second call, which pays for `loadState` and the build again. One
call, up to 20 queries, answered separately so a caller can tell which of its
guesses found the thing. `limit` is per query and defaults to 100 — a model
filters a long list more cheaply than it asks again.

`performSearch` counts all the matches, not the page it returns. FlexSearch
stops as soon as it has the ids it was asked for, so a `total` taken from a
page-sized search is the page size wearing a count's name; it is counted
separately up to `MAX_COUNTED_RESULTS`, and `totalIsLowerBound` says when that
bound was reached instead of letting the number lie.

Two things in the tool are load bearing:

- **The module order is sorted.** Indexing stops at a deadline, so the order
  decides what a partial answer contains. Sorted means the same call twice
  gives the same partial answer, and that narrowing with `include` predictably
  reaches what was dropped.
- **The deadline is checked between modules, never inside one**, and the first
  module is always indexed. `indexModule` is atomic — half a module in the index
  is a module whose absent half looks like content that does not exist — and a
  search that returned nothing because the clock had already run out is a worse
  answer than a slow one.

An excluded module is not an omission. `omittedModules` means the deadline was
hit; a caller has to be able to tell "you told me not to" from "I ran out of
time", because only one of them means retry.

## Testing

Run tests from root dir with:

```bash
pnpm test                           # All tests
pnpm test packages/core/src/...     # Specific test file
pnpm run -r typecheck               # Type checking
pnpm lint
pnpm format
```

### Test rules

1. Never "fix" an issue by changing the test file
2. Prefer to define test data in a type-safe manner using `s` and `c` from `initVal`. Search for examples.

## CI

CI (`.github/workflows/check.yml`) runs the following jobs on every push. Before declaring a change ready, run all of these from the repo root:

```bash
pnpm run lint                          # eslint .
pnpm -w run format                     # prettier --check .  (use -w from subdirs)
pnpm run -r typecheck                  # tsc --noEmit per package
pnpm test                              # jest
pnpm run build                         # top-level: preconstruct + pnpm --filter @valbuild/ui build
cd examples/next && pnpm run build     # next build for the example app
cd examples/tanstack && pnpm run build # vite build for the TanStack example (no CI job yet)
```

Two more checks have no CI job YET — `check.yml` has no `smoke` job and its
`e2e` matrix selects only `chromium` and `chromium-http` — so for now they are
yours to run. They are the gate for "the Studio does not come up at all", on
both frameworks and in an insecure context, which is the one class of failure
that reaches every user at once, so run them before shipping anything the
Studio loads through:

```bash
pnpm exec playwright test --project=tanstack                         # ~1 min
pnpm exec playwright test --project=chromium e2e/smoke.spec.ts \
  e2e/insecure-context.spec.ts                                       # ~4 min
```

Notes:

- `pnpm run build` at the root is NOT recursive — it only runs `preconstruct build && pnpm --filter @valbuild/ui build`. Do not use `pnpm -r build` to verify CI; recursive build pulls in example-project fixtures that aren't part of CI and have unrelated pre-existing issues.
- `examples/next` build is its own CI job and must be run separately. It is also the only job that type-checks with `next-env.d.ts` present, so a green `pnpm run -r typecheck` does not imply a green example build — see "'X' cannot be used as a JSX component" under Common Fixes.
- The `tanstack` Playwright project and the `examples/tanstack` build are the only things that run that app at all, and both were added after `crypto.randomUUID is not a function` shipped: nothing exercised TanStack, and nothing ran outside a secure context. Neither has a CI job yet — the workflow change adding `build-tanstack` and a blocking `smoke` job is pending a maintainer (the session that wrote them had no `workflow` scope). Until then a green CI does NOT mean the Studio comes up on TanStack. See `e2e/tanstack/studio.spec.ts`.
- `prettier --check .` walks the whole tree; untracked local files (e.g. `.claude/settings.local.json`) can show as warnings locally but won't affect CI since CI only sees tracked files.

### Don't run `pnpm run build` during development

Prefer `pnpm run -r typecheck` (or `pnpm --filter <pkg> run typecheck` for a single package) to validate cross-package changes. `pnpm run build` invokes `preconstruct build`, which replaces each workspace package's `main`/`module` entries with the built `dist/` artifacts. After that, downstream packages and the running dev server resolve imports against the built output, so further source edits in upstream packages are invisible until you rebuild.

If you do run `pnpm run build` (e.g., as a final CI check), you MUST run `pnpm preconstruct dev` afterward to restore the source-mapped entries so dev mode picks up live edits again.

## Running the val CLI

While developing the CLI itself, run it from `packages/cli` against the example app with `--root`:

```bash
cd packages/cli
pnpm exec tsx src/cli.ts validate --root ../../examples/next   # --fix to auto-fix, --watch to re-run on change
pnpm exec tsx src/cli.ts list-unused-files --root ../../examples/next
pnpm exec tsx src/cli.ts versions
```

This runs `src/` directly, so edits apply with no rebuild. `--root` is resolved with `path.resolve()` against cwd, so a relative path works.

**Do not use `pnpm start`.** The script is `tsx src/cli.ts --`, so pnpm produces `tsx src/cli.ts -- validate --root ...`; that trailing `--` makes meow treat the flags as positional input and the command dispatch rejects it with `Unknown command "validate --root ../../examples/next"`.

To exercise the packaged entry (`bin.js` → `require("./cli")` → preconstruct entrypoint) instead of `src/`, use either:

```bash
cd packages/cli && node bin.js validate --root ../../examples/next
cd examples/next && ./node_modules/.bin/val validate   # the `val` bin is linked here only, not in root node_modules/.bin
```

**Run `validate` whenever you touch `packages/cli` or `packages/server`.** It is not optional coverage:

- `validate` and `list-unused-files` are the only callers of `createService` → `loadValModules`, which evaluates the project's `val.modules.ts` and every `*.val.ts` in a `node:vm` sandbox. Nothing in the Next.js runtime exercises that path — the Next server gets its `ValModules` from the app's own `import valModules from "../val.modules"`.
- `pnpm test` only reaches `createService` directly from jest, so it misses breakage in the CLI's own entry and argument handling. Before shipping a CLI change, also do one run via `bin.js` / the `val` bin so the packaged entrypoint is covered.

The example app might have known pre-existing content errors (missing image files, stale image metadata), so a non-zero error count can be expected. What you are verifying is that the modules **load and validate at all** — a regression in the loader shows up as a thrown error or `0 valid` files, not as a changed error count.

## Working with Images

### ImageSource Shape

An `ImageSource` at runtime is:

```typescript
{
  path: string;          // "/public/val/photo_a1b2c.jpg", or a remote URL
  width?: number;        // read from the bytes by --fix / the VS Code extension
  height?: number;
  mimeType?: string;
  alt?: string;          // authored
  hotspot?: { x: number; y: number };  // authored
  patch_id?: string;     // set server-side on uncommitted/draft images
}
```

A gallery-backed field (`s.image(galleryVal)`) carries only `path`, `alt` and
`hotspot`: the rest lives in the gallery, keyed by path.

Defined in `packages/core/src/source/media.ts`, along with `mediaUrl`,
`resolveMedia` and `fillFromGallery` — the one implementation each of "where are
these bytes served from" and "what does the gallery know about this path".

### Re-encoding uploads (`encode`)

`s.image({ encode: { type: "webp" } })` and `s.imageset({ encode })` convert an
upload to WebP before it is uploaded. **Off by default.**
`quality` defaults to 0.8, `maxWidth`/`maxHeight` to 2560, and `encode: false`
turns it off where a gallery turned it on.

There are two encoders and one set of decisions. The decisions —
`resolveEncodeSettings`, `fitWithin`, `isSkippedSource`, `chooseEncoded` — are
in `packages/shared/src/internal/media/encodeImageDecisions.ts`. The Studio's
encoder is `packages/ui/spa/utils/encodeImage.ts` (a `<canvas>`, called from
`readImageFromFile`); the MCP image tool's is `sharpImageProcessor` in
`@valbuild/mcp/sharp`. Change what `encode` MEANS in the shared file, or the
two drift.

Either encoder runs before the hash, and that is the only correct place for it:
`createFilename` derives the extension from the data URL's mime type, so
swapping the bytes before the hash makes the filename, `mimeType`, dimensions
and remote validation hash all follow — and swapping them after makes every one
of those describe a file that was never uploaded.

Things that will bite: `accept` beats `encode` (validation checks the stored
mimeType against `accept`); a bigger WebP loses to the original unless the image
was downscaled; SVG/GIF/AVIF are never converted; and the produced type must be
checked because `canvas.toBlob` silently falls back to PNG. `encode` is stripped
in `getValidationBasis` so it cannot re-validate published remote refs. See
[architecture/media.md](../architecture/media.md).

### Creating an Image Patch

There are two distinct patch shapes depending on context:

#### A) Single image field (`ImageField`)

Use `createFilePatch` from `packages/ui/spa/components/fields/FileField.tsx`. It returns a `Patch` with two ops:

1. **`replace`** — sets the field value to the new media object (`path`, plus what
   was read from the bytes, unless the field is gallery-backed)
2. **`file`** — carries the binary data (base64 data URL string), `filePath` (the
   `path`), and `metadata`

```typescript
const { patch, filePath } = await createFilePatch(
  patchPath, // string[] — field path from useAddPatch
  data.src, // string — base64 data URL from FileReader
  data.filename, // string | null
  fileHash, // string — SHA-256 of the binary data
  metadata, // ImageMetadata
  "image", // subType
  remoteData, // remote config or null for local files
  directory, // defaults to "/public/val"
  galleryBacked, // true → write only `path`; the gallery has the rest
);
```

When the field has a `referencedModule` (gallery-backed), after uploading the image patch you also need to add the metadata entry to the gallery module via `addModuleFilePatch(referencedModule, [{op: "add", path: [filePath], value: metadata}], "record")`.

#### B) Gallery module (`ModuleGallery`)

In `ModuleGallery` (`packages/ui/spa/components/fields/ModuleGallery.tsx`), patches are built inline without `createFilePatch`. The gallery stores images as a record keyed by file path:

```typescript
// Adding an image to a gallery
const patch: Patch = [
  {
    op: "add",
    path: [...patchPath, ref], // ref is the file path key
    value: {
      width: metadata.width,
      height: metadata.height,
      mimeType: metadata.mimeType,
      alt: null,
    },
  },
  {
    op: "file",
    path: [...patchPath, ref],
    filePath: ref,
    value: res.src, // base64 data URL
    metadata,
    remote: isRemote,
  },
];
```

Key difference: the `replace` op is an `add` (adding a new record entry), and the `value` is the metadata alone — the path is the key, so it is not repeated inside.

**Deleting** from a gallery uses `remove` + a `file` op with `value: null`:

```typescript
const patch: Patch = [
  { op: "remove", path: [...patchPath, ref] },
  {
    op: "file",
    path: [...patchPath, ref],
    filePath: ref,
    value: null,
    remote: isRemote,
  },
];
```

**Selecting from a gallery** (via `ModuleMediaPicker`) uses a plain `replace` with
just the path — no `file` op, since the binary already exists in the gallery
module, and no metadata, since the gallery is where it lives:

```typescript
addPatch(
  [{ op: "replace", path: patchPath, value: { path: entry.filePath } }],
  "image",
);
```

#### Ref computation for remote files

Both `ImageField` and `ModuleGallery` compute the `path` differently for remote vs local:

- **Local**: `ref = "${directory}/${filename}"` (e.g. `/public/val/photo_a1b2c.jpg`)
- **Remote**: `ref = Internal.remote.createRemoteRef(remoteHost, { publicProjectId, coreVersion, bucket, validationHash, fileHash, filePath })` — a full URL encoding project/bucket/hash info

The filename is generated by `Internal.createFilename` which embeds the first 5 hex chars of the SHA-256 hash (e.g. `photo_a1b2c.jpg`).

### Uploading Patches (Async Two-Phase Flow)

Any patch containing `file` ops must use `addAndUploadPatchWithFileOps` (not the plain `addPatch`). The upload is a **two-phase** process:

1. **Split** the patch into `file` ops (binary data) and everything else (`patchOps`). In `patchOps`, the file op `value` is replaced with its **SHA-256 hash** (so the patch JSON never contains the full binary).

2. **Upload files first** — each file op is uploaded via `POST {baseUrl}/patches/{patchId}/files` with `Content-Type: application/json` (NOT FormData). The JSON body contains `{ filePath, parentRef, data, type, metadata, remote }`.

3. **Sync the patch** — after all file uploads succeed, `addPatchAwaitable` sends the patch (with SHA-256 placeholders) to the server via `PUT /patches`.

```typescript
addAndUploadPatchWithFileOps(
  patch,
  "image", // or "file" for non-image files
  (errorMessage) => {
    /* handle error, revert optimistic URL */
  },
  (bytesUploaded, totalBytes, currentFile, totalFiles) => {
    /* handle progress */
  },
);
```

Key details:

- Upload URL comes from `/direct-file-upload-settings` endpoint — in FS mode it returns `{ baseUrl: "/api/val/upload", nonce: null }`
- The upload uses `XMLHttpRequest` for progress tracking (`xhr.upload` progress events)
- `patchId` is created via `syncEngine.createPatchId()` before uploading
- Files must be uploaded **before** the patch is synced (upload first, then `addPatchAwaitable`)
- `ModuleGallery` supports drag-and-drop multi-file uploads — it loops through dropped files sequentially, calling `addAndUploadPatchWithFileOps` for each

### Getting the URL of an Image

One function: `Internal.mediaUrl({ path, patch_id? })`. Local and remote are the
same shape, so there is nothing to branch on — remote is a path that does not
start with `/public`. `Internal.resolveMedia(src)` is the same thing plus a
spread, for when you want the whole resolved value.

| State                     | `path`                            | URL                                                          |
| ------------------------- | --------------------------------- | ------------------------------------------------------------ |
| Published, local          | `/public/val/photo.jpg`           | `/val/photo.jpg` (strips `/public`)                          |
| Draft, local              | `/public/val/photo.jpg`           | `/api/val/files/public/val/photo.jpg?patch_id=...`           |
| Published, remote         | `https://remote.val.build/file/…` | the path itself                                              |
| Draft, remote             | `https://remote.val.build/file/…` | `/api/val/files/{filePath}?patch_id=...&remote=true&ref=...` |
| Absolute, outside /public | `/images/photo.jpg`               | the path itself                                              |

In the Studio, look the `patch_id` up first — `useFilePatchIds()` is keyed by
`path`:

```typescript
const filePatchIds = useFilePatchIds();
const patchId = filePatchIds.get(source.path);
const url = Internal.mediaUrl({
  path: source.path,
  ...(patchId ? { patch_id: patchId } : {}),
});
```

A gallery gives you a bare path string rather than a media object (the record key
is the path), and that is all `mediaUrl` needs.

**In consumer code**, `url` is generated by `stegaEncode` (so it carries the edit
tag) and read as `img.url` — along`img.path`, `img.width`, `img.alt` and the rest,
which are the source's own fields. There is no `metadata` object: `url` is the
only thing that was not authored. For a gallery-backed field, `fillFromGallery`
supplies the dimensions and mime type at resolve time.

#### Server-side file serving

The `/api/val/files` endpoint (`ValServer.ts`) serves draft files by loading them from the patch directory (via `getBase64EncodedBinaryFileFromPatch`) and published files directly from the filesystem (`getBinaryFile`). No auth is required on this endpoint (patch IDs serve as unguessable tokens).

## Releasing

Releases go out through changesets: land a PR with a changeset on `main`, the
Release workflow opens a "Version Packages" PR, and merging that publishes to
npm.

### The changeset summary is the release note

`.changeset/config.json` generates changelogs with
`@changesets/changelog-github`, so `changeset version` writes each changeset's
summary into every affected package's `CHANGELOG.md` under the new version,
prefixed with the PR link, the commit link and the author. `changesets/action`
then uses that entry as the body of the GitHub Release it creates for the tag,
and the file ships in the npm tarball.

So the summary in `.changeset/*.md` is what users read on the release — write it
for them, not for the reviewer of the PR. It is Markdown, and lists, code fences
and `#123` issue references all survive (the last gets linkified).
Front-matter-style lines in the summary are consumed rather than printed:
`pr: 123`, `commit: <sha>` and `author: @who` override what changesets inferred
from git, which is how a changeset that landed via a squash or a rebase gets the
right link.

Two things to know before running `changeset version` by hand:

- It needs a `GITHUB_TOKEN` in the environment. Without one the GitHub API call
  fails with `Bad credentials` and **no files are written** — the generator is
  fail-closed, so a missing token stops the release rather than publishing a
  version with empty notes. CI has the token; a laptop usually does not.
- Normal releases do not need it run by hand at all. The Release workflow runs
  `pnpm run version-packages` and puts the result in the "Version Packages" PR.

**After a release, ask whether to update the starter template** — and default to
yes. The template repository ([`valbuild/template-nextjs-starter`](https://github.com/valbuild/template-nextjs-starter))
pins `@valbuild/*` versions in its `package.json`, so it keeps serving the old
release to everyone who runs `npm create @valbuild` / `pnpm create @valbuild`
until someone bumps it. So, once the new version is on npm:

1. Ask the user whether to update the template now, proposing that we do.
2. Bump the `@valbuild/*` dependencies in the template's `package.json`, install
   so the lock file follows, and open a PR on the template repository.
3. **Test it out** — do not ship the bump on a green typecheck alone. Install and
   run the template against the new version, open `/val`, and check that the
   Studio loads and that an edit can be made and saved. Breakage from a release
   shows up here first, and this is the last place to catch it before it is what
   every new project starts from.

### Publishing a package for the FIRST time

A new package cannot be published by CI, and the failure looks like nothing to do
with that:

```
@valbuild/mcp@0.123.0
└ E404: Not Found - PUT https://registry.npmjs.org/@valbuild%2fmcp - Not found
  The requested resource '@valbuild/mcp@0.123.0' could not be found or you do not
  have permission to access it.
```

The Release workflow publishes with npm trusted publishing (OIDC), and a trusted
publisher configuration is **per package** — so a package that has never been
published has none, and the OIDC token has no permission to create it. npm answers
a PUT it will not authorize with 404 rather than 403, which is why this reads as
"missing" rather than "forbidden". There is no way to pre-register the name:
npm has no reserve-a-name flow, and the org's Teams → Add package screen only
enumerates packages the org already owns. Nothing is staged, so — unlike the
E401 below — there is nothing to approve and the version number is not burned.

`changeset publish` goes in dependency order and stops at the failure, so every
package that depends on the new one is never attempted. Expect a half-published
release: fix the new package, then re-run the job, and `changeset publish` picks
up exactly what is missing.

**Bootstrap it by hand, and use `pnpm publish`:**

```bash
pnpm install && pnpm run build     # `files` ships only dist/, so build first
cd packages/<new-package>
pnpm publish --access public --no-git-checks
pnpm preconstruct dev              # back in the repo root, restore dev entries
```

`--access public` because a scoped package's first publish defaults to
_restricted_, and a restricted package 404s for everyone else — indistinguishable
from not existing. A brand-new package also takes up to a couple of minutes to
become publicly readable, so a 404 right after a successful publish is usually
just the read path catching up.

**`pnpm publish`, never `npm publish`.** This is the one that cost a release.
Every package here declares its siblings as `"@valbuild/x": "workspace:*"`, and
that protocol is rewritten to a real version **at pack time by pnpm**. `npm
publish` uploads the manifest verbatim, so the published package asks consumers
to resolve `workspace:*` and cannot be installed by anything:

```
npm  → EUNSUPPORTEDPROTOCOL  Unsupported URL Type "workspace:": workspace:*
pnpm → ERR_PNPM_WORKSPACE_PKG_NOT_FOUND
```

It is unfixable in place: npm versions are immutable, and unpublishing burns the
number permanently rather than freeing it. Everything pinning that exact version
— `@valbuild/next` pins its siblings exactly — is broken with it, so the recovery
is a patch release of the bad package (changesets bumps the dependents for you),
`npm deprecate` on both bad versions, and `npm dist-tag add <pkg>@<last good>
latest` in the meantime so installs stop failing.

Once the package exists, add its trusted publisher — the package page →
Settings → Trusted publishing, organization `valbuild`, repository `val`,
workflow `release.yml`, no environment, **`npm publish` ticked** — and CI handles
it from then on, provenance included. The hand-published version is the only one
without an attestation.

### The Release job fails with `E401 … Failed to generate Web Auth URLs`

Symptom: `changeset publish` publishes some packages and then fails on one:

```
@valbuild/language-server@0.120.1
└ E401: 401 Unauthorized - PUT https://registry.npmjs.org/@valbuild%2flanguage-server - Failed to generate Web Auth URLs due to error: BadRequestError: token is invalid
```

Re-running the job does not help; the same package now fails with

```
└ E409: 409 Conflict - PUT https://registry.npmjs.org/@valbuild%2flanguage-server - Cannot publish over previously staged version "0.120.1".
```

and the packages that depend on it (`cli`, `next`) are never attempted.

→ Nothing is wrong with the token or the workflow. The Release workflow publishes
with npm trusted publishing (OIDC — note the `id-token: write` permission and the
absence of an `NPM_TOKEN`), and every `@valbuild/*` package has a trusted
publisher configuration on npmjs.com pointing at `valbuild/val` +
`release.yml`. Since May 2026 that configuration carries an **Allowed actions**
choice: `npm stage publish` is always allowed, and `npm publish` (direct
publishing) is a separate checkbox. Configurations created before that date
were grandfathered to allow `npm publish`; newer ones are not unless the box was
ticked. When the workflow runs `npm publish` against a package whose
configuration only allows staging, the registry **stages** the version and then
tries to complete the publish with a web-auth 2FA prompt, which an OIDC token
cannot answer — hence the 401. The tarball stays in the staging area, so every
re-run gets the 409.

Fix, in this order:

1. On npmjs.com, open the **Staged Packages** tab and either **Approve** the
   staged version (2FA; this publishes it with the provenance from the original
   run, which is what happened for `language-server@0.120.0`) or **Reject** it
   so the version number is free again. `npm stage approve <stage-id>` from a
   laptop with 2FA does the same; OIDC tokens cannot approve.
2. Fix the configuration so it does not happen next release: npmjs.com →
   the package → Settings → Trusted publishing. Connections cannot be edited,
   so delete the GitHub Actions one and add it back (organization `valbuild`,
   repository `val`, workflow filename `release.yml`, no environment) with
   **`npm publish` ticked under Allowed actions**. Configurations created after
   2026-09-03 default to stage-only, so the box has to be ticked explicitly.
3. Re-run the failed Release job. `changeset publish` skips versions already on
   the registry, so it picks up exactly the packages that are still missing.

A newly added package is the usual trigger: its trusted publisher gets created
long after everyone else's, with the newer default. Tick the `npm publish` box
when you set it up, and expect this failure on the first release if you forget.

## Adding a `ValidationFix` code

A fix code is declared in one place and DISPATCHED ON in seven, spread over five
packages. Nothing makes you visit them: the union is a `const` array, so a
missing entry is a silent no-op rather than a type error, and the symptom is
always the same — the error is reported somewhere it should have been quietly
repaired, or a quick fix is offered nowhere while looking fine everywhere else.

Visit all of these, in this order:

1. **`core/src/schema/validation/ValidationFix.ts`** — the code itself.
2. **`shared/src/internal/ApiRoutes.ts`** — a `z.literal` in the fixes union.
   Not compiler-enforced: the zod schema is typed against the core union, so a
   missing literal is a RUNTIME parse failure of the response that carries it.
3. **The schema** that reports it (`fixes: [...]` on the `ValidationError`).
4. **`shared/…/validation/partitionValidationErrors.ts`** — exhaustive switch,
   so this one DOES fail to compile. `true` means the Studio hides it because
   the server repairs it on save; `false` means an editor has to see it. This
   also decides publish gating, via `filterBlockingValidationErrors` — which is
   why `blockingValidationErrors.ts`, `ValErrorProvider` and `createSystem` need
   nothing of their own.
5. **`server/src/createFixPatch.ts`** — the branch that builds the patch. Read
   the schema at the path with `Internal.resolvePath(modulePath, moduleSource,
moduleSchema)` rather than trusting what the error carries.
6. **`server/src/fixHandlers.ts`** — the entry the CLI dispatches on. The
   registry's key type excludes the four `SCHEMA_SOURCE_FIXES`, so a fix that is
   neither excluded nor registered fails to compile; one that is missing at
   runtime makes `val validate` emit `unknown-fix`. Return
   `shouldApplyPatch: true` to hand off to `createFixPatch`, and a
   `fixableErrorMessage` when `ctx.fix` is off, or `--fix`-less runs report it as
   a plain error instead of a fixable one.
7. **`language-server/src/codeActions.ts`** — `LOCAL_FIXES` and `FIX_TITLES`.
   Neither is exhaustive. A fix absent from `LOCAL_FIXES` is silently never
   offered as a quick fix, which is how you get a diagnostic in VS Code with no
   lightbulb and no explanation.

Two lists that are NOT per-fix, and must not be copied: `SCHEMA_SOURCE_FIXES`
(`shared/src/internal/resolveSchemaSourceFixes.ts`) is the set that only a
project-wide snapshot can answer — the language server imports it as
`DEFERRED_FIXES` rather than keeping its own, because its own fell two behind.

**Verify end to end, not by reading.** Build a throwaway project in the
scratchpad and run the CLI against it — `pnpm exec tsx src/cli.ts validate
--root <dir>` from `packages/cli`, then again with `--fix`, and diff the file.
That exercises module loading, validation, the handler, the patch and the TS
rewrite in one go; the unit tests cover none of that seam.

## Common Fixes

### `prettier --check` fails on a file `prettier --write` just wrote

Symptom: the `format` CI job is red on a Markdown file, and running
`pnpm run format:fix` does not fix it — `--check` keeps rejecting the file no
matter how many times you write it.

→ Prettier 3.9.x re-indents a wrapping continuation paragraph inside a
**task-list item** by four more spaces on every pass, so formatting never
reaches a fixed point and `--check` can never pass. Five lines are enough to
reproduce it:

```markdown
- [x] Decide something here, and it
      already had one. The double mount render was the cost.

      `peek` resolved the path all the way to the value and then discarded it,
      returning only a status. It now carries the value.
```

Run that through `prettier` repeatedly and the last two lines march right: 6,
10, 14, 18 spaces. A plain `- ` item is stable, and so is a single-line
continuation paragraph — it takes a `- [x] ` / `- [ ] ` item (content column 6)
plus a paragraph that wraps. `packages/ui/spa/stores/openquestions.md` has
exactly that shape.

The whole 3.9 line is affected (3.9.0 through 3.9.6 all diverge) and 3.8.5 is
fine, so **prettier is pinned to `~3.8.5`, not `^3.8.5`** — a caret range would
let 3.9 back in and turn the `format` job permanently red. Do not widen it
without re-running the snippet above against the version you want.

### "Type 'X' does not satisfy constraint 'Source'"

→ Add the type to `SelectorSource` union in `packages/core/src/selector/index.ts`

### "Property 'X' does not exist on type 'never'"

→ Check if all variants are handled in conditional types (especially in `ImageNode`, `RichTextSource`)

### "'X' cannot be used as a JSX component" / "Type 'Element' is not assignable to type 'ReactNode'"

Symptom: `cd examples/next && pnpm run build` fails while `pnpm run -r typecheck` stays green.

```
Type error: 'ValApp' cannot be used as a JSX component.
  Its type '(...) => JSX.Element' is not a valid JSX element type.
    Type 'Element' is not assignable to type 'ReactNode'.
```

→ Two different `@types/react` versions ended up in the same TypeScript program. `ReactElement.key` is `Key | null` (`string | number | null`) in older type packages but `string | null` from `@types/react` 18.2.38 onwards, so a `JSX.Element` built from one copy is not assignable to the other copy's `ReactNode`. `skipLibCheck: true` hides the duplicate global `JSX` declarations, so this confusing JSX error is the only symptom.

Only `examples/next`'s build catches it: `next-env.d.ts` is gitignored, so a bare `tsc --noEmit` never pulls in `next`'s global type tree. `next build` generates that file first, which drags in `next`'s own React type references — and `next` has no `@types/react` of its own, so it resolves whichever copy pnpm hoisted into `node_modules/.pnpm/node_modules/@types/react`. Which copy that is varies by pnpm version and platform, so this can be green locally and red in CI.

Diagnose:

```bash
ls node_modules/.pnpm | grep '^@types+react@'          # more than one version => this bug
ls -l node_modules/.pnpm/node_modules/@types/react     # which copy got hoisted
cd examples/next && pnpm run build                     # generates next-env.d.ts, needed for the repro
./node_modules/.bin/tsc --noEmit --incremental false --listFiles \
  | grep -o '@types+react@[0-9.]*' | sort | uniq -c
```

Fix: make every workspace package declare the same `@types/react` and `@types/react-dom` version, then `pnpm install --no-frozen-lockfile` and commit `pnpm-lock.yaml`. This includes the private fixtures under `packages/server/test/example-projects/*` — they are listed in `pnpm-workspace.yaml`, so they are real workspace packages and their pins contribute to the hoisted layout.

This is not triggered by React itself changing — it is the _type_ packages drifting apart. Expect it whenever `@types/react` is bumped in some packages but not all, or when a package or fixture is added with a different pin. The repo is on React 19 and `@types/react` 19 everywhere, the fixtures under `packages/server/test/example-projects/*` included - nothing builds those, but their pins still decide the hoisted layout, so they have to move with everyone else's.
