# Media: `s.images()`, `s.files()`, `s.image()`, `s.file()`

## The four names are two pairs on different axes

`s.images()` / `s.files()` are **whole-module collections**. `s.image()` /
`s.file()` are **fields**. They are not variants of each other.

|       | collection (is the module)                     | field (lives at a path)                                      |
| ----- | ---------------------------------------------- | ------------------------------------------------------------ |
| image | `s.images({ directory, accept, alt, remote })` | `s.image({ directory, accept })` or `s.image(galleryModule)` |
| file  | `s.files({ accept, directory, remote })`       | `s.file({ accept })`                                         |

This is why `s.images(galleryModule)` does not typecheck: `s.images()` _defines_ a
collection, it does not reference one. A field backed by a gallery is
`s.image(galleryModule)`.

A collection is a `RecordSchema` carrying a `mediaType` marker, **keyed by file
path**, whose values are metadata — `{width, height, mimeType, alt}` for images,
`{mimeType}` for files. It is the entire module:

```ts
export default c.define(
  "/content/gallery.val.ts",
  s.images({ directory: "/public/img" }),
  {},
);
```

A field holds one `ImageSource` / `FileSource`:
`{_ref, _type: "file", _tag: "image", metadata}`.

**There is no multi-valued gallery-backed field.** `s.image(module)` picks one
image from a gallery; nothing picks several. Adding it means a new schema type
(source shape, serialization, validation, UI, patch shape), not a small change.

## Where the bytes land

Three levels of precedence for a field:

1. the field's own `directory` (`s.image({ directory })`),
2. the `directory` of the gallery it references,
3. `/public/val` — the `createFilePatch` default.

For a collection it is always the schema's `directory`. `s.file()` has no
`directory` option at all (`FileOptions` is `{accept?}`), so a standalone file
field can only use 2 or 3.

The filename comes from `Internal.createFilename`: basename plus the first five
hex of the content hash, so `red-8x8.png` → `red-8x8_bfbd0.png`. Identical bytes
always produce the same ref.

## Three patch shapes, one per path

Worth knowing because each has had its own bugs, and a test for one proves
nothing about the others.

**Collection upload** — `add` at `[…, ref]` with _flat_ metadata, plus a `file` op:

```ts
[{ op: "add", path: [ref], value: { width, height, mimeType, alt: null } },
 { op: "file", path: [ref], filePath: ref, value: <bytes>, metadata }]
```

**Field upload** — `replace` with the whole source object, plus a `file` op.

**Gallery-backed field upload** — **two patches**: `replace` + `file` on the
field's module, _and_ an `add` into the gallery module for the metadata. The field
value then carries `{_ref, _type, _tag}` and **no `metadata`**, because the
metadata lives in the gallery entry. One place per fact.

Bytes never travel inside a patch: they are POSTed separately and the `file` op
carries a SHA-256.

## How a URL is chosen — the part that keeps breaking

Two states, and conflating them is the recurring bug:

| state                                         | where the bytes are | URL                                    |
| --------------------------------------------- | ------------------- | -------------------------------------- |
| unpublished (created, or saved to the server) | the patch directory | `/api/val/files{path}?patch_id=…`      |
| published                                     | the committed path  | `/public/x/y.png` served as `/x/y.png` |

`filePatchIds` is the map that decides, and its gate must be **`appliedAt`** — has
this patch _shipped_ — not pending-vs-saved. "Saved" only means `PUT /patches`
succeeded; only `/save` writes the committed path. **Every pending edit sits
between those two**, so gating on "unsaved" makes a just-uploaded image render
broken the moment its write comes back.

> `next dev` answers an uncommitted `/public` path with the app's HTML, so a
> broken tile still returns **200** with a `src` that looks right. Only decoding
> it — `naturalWidth > 0` — can tell. Any test here asserts on that.

## Nav placement

A collection is deliberately **not** an Explorer file. `collectMediaModules`
removes galleries from the explorer tree and lists them under **Media**, labelled
by directory, because the directory is the unit an editor thinks in. Removing
them from one place and failing to add them to the other leaves a gallery with no
entry point at all — which is exactly what happened once.

## Validation

Collections carry checks a field does not:

- `images:check-unique-folder` — no two galleries may claim one directory,
- `images:check-all-files` — the directory may hold files the gallery does not track.

Both carry `fixes`, so `filterBlockingValidationErrors` keeps them out of the
publish gate. A **required alt** (`s.images({ alt: s.string().minLength(4) })`) is
blocking, and upload sets `alt: null` — so such a gallery is unpublishable until
someone types alt text. Correct, but it means uploading alone never reaches a
publishable state there.

## Fixtures

`examples/next/content/` has one module per shape, each gallery shipping one
_committed_ entry so "can I see what is already there" is covered by the repo:

- `mediaFixtures.val.ts` — `s.images({ directory: "/public/test/subdir" })`
- `fileGallery.val.ts` — `s.files({ directory: "/public/test/files" })`
- `mediaFields.val.ts` — `s.image()`, `s.image({ directory })`,
  `s.image(gallery)`, `s.file()`, and the same inside a union

`e2e/media.spec.ts` drives all of them. The fixture images are real 8×8
solid-colour PNGs (74 bytes) rather than 1×1 transparent ones, so a broken tile is
visibly broken.
