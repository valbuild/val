# Media: `s.images()`, `s.files()`, `s.image()`, `s.file()`

## The four names are two pairs on different axes

`s.images()` / `s.files()` are **whole-module collections**. `s.image()` /
`s.file()` are **fields**. They are not variants of each other.

|       | collection (is the module)                        | field (lives at a path)                                      |
| ----- | ------------------------------------------------- | ------------------------------------------------------------ |
| image | `s.images({ directory, accept?, alt?, remote? })` | `s.image({ directory, accept })` or `s.image(galleryModule)` |
| file  | `s.files({ directory, accept, remote? })`         | `s.file({ accept })`                                         |

A collection's `directory` is **required**. It used to default to `/public/val`,
which meant a gallery that had simply not said where it wanted its files shared a
directory with every other one — and `images:check-unique-folder` (below) then
failed on a collision the author never chose.

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

## The shape

Media is a plain object with a `path`. There is no marker on the value, so
nothing may decide "this is an image" by looking at it — the **schema** says so
(`type === "image" | "file"`). That is what lets the same object be written in a
`.val.ts` and in a `*.val.json` entry, where a function call cannot be written
at all.

```ts
{ path: "/public/val/hero_a1b2c.png", width: 944, height: 944,
  mimeType: "image/png", alt: "A hero", hotspot: { x: 0.5, y: 0.3 } }
```

`path` is a plain `string`, not `` `/public/${string}` ``: moving a file to
remote should not be a type error. **Remote is not a different kind of value,
only a path outside `/public`** — `isRemoteMediaPath` is the whole test.

`width`, `height` and `mimeType` are what Val read from the bytes; `alt` and
`hotspot` are what a person typed. They share one object, which is why `--fix`
writes the derived ones **one property at a time** rather than replacing the
object.

A **gallery-backed** field (`s.image(galleryModule)`) carries neither: the
gallery has them, keyed by path, and repeating them is how two copies of one
fact get to disagree. `s.image(galleryVal)` refuses them at author time, and
validation refuses a path the gallery does not track. `fillFromGallery` supplies
them at resolve time — including `alt`, but only when the field has none, so a
per-image override wins. A gallery whose `alt` is a locale record holds an object
rather than a string; that one is left alone, and making the override
locale-shaped is a separate change.

`patch_id` also appears on a media source whose bytes are not committed yet. It
is injected server-side, never authored, and `toExpression` drops it before
writing a `.val.ts` — a whole-object write built from the client's optimistic
view would otherwise print it into a user's file.

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

## Re-encoding, and why it is a one-line seam

`s.image({ encode })` / `s.images({ encode })` convert an upload to WebP in the
**browser**, before it is uploaded. Off unless asked for; `{type: "webp"}` is
the whole opt-in, with `quality` (0.8), `maxWidth` and `maxHeight` (2560)
defaulted. A field inherits its gallery's setting the way it inherits `accept`
and `directory` — it has to, because `s.image(galleryVal)` serializes with
**empty options** and has nothing of its own to read.

It is one seam — `encodeImage`, called from `readImageFromFile` — because
`createFilename` derives the extension from the data URL's mime type rather
than from the filename. Swap the bytes before the hash and the filename, the
recorded `mimeType`, the dimensions and the remote validation hash all follow;
swap them after and each of those describes a file nobody uploaded.

There is now a **second** encoder at a second seam: the MCP `upload_image` tool
runs the same conversion on `sharp`, server-side, before it hashes anything
(`sharpImageProcessor` in `@valbuild/mcp/sharp`). Two encoders, but not two sets
of rules — every decision below lives in
`packages/shared/src/internal/media/encodeImageDecisions.ts` and both call it.
Changing what `encode` means anywhere else changes it for one of them only, and
the symptom is a project whose images differ by who uploaded them.

Four rules, each of which is a bug if dropped:

- **`accept` beats `encode`.** Validation checks the stored `mimeType` against
  `accept`, so converting under `accept: "image/png"` would upload a file the
  schema rejects on arrival. The original goes up instead.
- **Bigger output loses**, unless the image was downscaled — then the original
  is the wrong size whatever it weighs. Measured: the 74-byte 8×8 fixture PNG
  becomes a **548-byte** WebP, while a 1200×900 gradient goes 155 KB → 12 KB.
- **SVG, GIF and AVIF are never touched**, nor is a WebP that already fits.
- **Decoding is `createImageBitmap(file, {imageOrientation: "from-image"})`,
  never `new Image()`** — that flag is what applies EXIF rotation, and the WebP
  we write carries no EXIF, so the other path would silently rotate portrait
  photos. Where it is unavailable, nothing is re-encoded.

`encode` is stripped in `getValidationBasis`: it says how bytes were produced,
not whether the bytes that arrived are valid, so leaving it in would re-validate
every remote file in the project whenever a quality setting moved.

The AI chat's image attachments (`useAI.uploadAiImage`) are **not** re-encoded.
They are posted straight to the content service for the model to look at and
never become a patch, so they are not on this path at all.

## Three patch shapes, one per path

Worth knowing because each has had its own bugs, and a test for one proves
nothing about the others.

**Collection upload** — `add` at `[…, ref]` with _flat_ metadata, plus a `file` op:

```ts
[{ op: "add", path: [ref], value: { width, height, mimeType, alt: null } },
 { op: "file", path: [ref], filePath: ref, value: <bytes>, metadata }]
```

**Field upload** — `replace` with the whole media object, plus a `file` op.

**Gallery-backed field upload** — **two patches**: `replace` + `file` on the
field's module, _and_ an `add` into the gallery module for the metadata. The field
value is then `{path}` alone, because the metadata lives in the gallery entry.
One place per fact.

**Inside a `.jsonValues()` entry** — the same two ops, but the `patch_id` for the
drafted bytes goes into the _entry's_ draft content, not the module source: the
entry is an opaque `{_type:"json"}` marker there, and reaching into it fails the
op and poisons the module's whole patch chain.

Bytes never travel inside a patch: they are POSTed separately and the `file` op
carries a SHA-256.

## How a URL is chosen — the part that keeps breaking

Two states, and conflating them is the recurring bug:

| state                                         | where the bytes are | URL                                    |
| --------------------------------------------- | ------------------- | -------------------------------------- |
| unpublished (created, or saved to the server) | the patch directory | `/api/val/files{path}?patch_id=…`      |
| published                                     | the committed path  | `/public/x/y.png` served as `/x/y.png` |

`Internal.mediaUrl` is the one implementation of that rule — it was two functions
(`convertFileSource` / `convertRemoteSource`) split by a marker rather than by
anything about the answer.

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
  `s.image(gallery)`, `s.file()`, and the same inside a union. Also the fixture
  the language server's media-path completion tests open as an unsaved buffer:
  those completions are schema-driven now, so they need a module `val.modules`
  actually registers.

`e2e/media.spec.ts` drives all of them. The fixture images are real 8×8
solid-colour PNGs (74 bytes) rather than 1×1 transparent ones, so a broken tile is
visibly broken.
