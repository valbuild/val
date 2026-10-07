# Media: `s.imageset()`, `s.fileset()`, `s.fontset()`, `s.videoset()`, `s.image()`, `s.file()`, `s.video()`

## The four names are two pairs on different axes

`s.imageset()` / `s.fileset()` are **whole-module collections**. `s.image()` /
`s.file()` are **fields**. They are not variants of each other.

|       | collection (is the module)                    | field (lives at a path)                                         |
| ----- | --------------------------------------------- | --------------------------------------------------------------- |
| image | `s.imageset({ dir, accept?, alt? })`          | `s.image({ dir, accept })` or `s.image(galleryModule)`          |
| file  | `s.fileset({ dir, accept })`                  | `s.file({ accept })` or `s.file(collectionModule)`              |
| video | `s.videoset({ dir, accept?, alt?, stream? })` | `s.video({ dir, accept, stream })` or `s.video(videosetModule)` |

Remote is a **method, not an option**, everywhere: `s.imageset({...}).remote()`,
`s.fileset({...}).remote()`, `s.image().remote()`, `s.file().remote()`. It used to
be `{ remote: true }` on the two collections and a `.remote()` on the two fields,
which meant the same fact was spelled two ways depending on which of the four you
were looking at.

### `files: { remote: true }`: every one of them remote, for a whole project

`initVal({ files: { remote: true } })` makes `s.image()`, `s.file()`,
`s.video()`, the three sets and `s.richtext({ img: true })` come back with
`.remote()` already on them (`initSchema`). The FACTORIES change, not the
schemas: what comes out serializes byte-identically to a hand-written
`.remote()`, so the Studio, the MCP tools, validation and publishing need to know
nothing about the setting. A local path in such a project is the ordinary
`image:upload-remote` error, and `val validate --fix` is the ordinary fix.

The Val app REQUIRES it: with `VAL_ENV=app` the server refuses to start without
it (`APP_MODE_REQUIRES_REMOTE_FILES` in `valServerConfig.ts`), and `val publish`
refuses before it builds. The app has no repository for an upload to land in.

It lives in `val.config.ts` rather than being switched on by the environment,
and that is the point of it. The schemas are built when `val.config.ts` and the
modules are evaluated — by the app, but also by `val validate`, the language
server and `pnpm dev`. A switch only the app could see would leave all of those
reading the media as local: every remote image an error, and `--fix` downloading
it back into the repository. Do not "simplify" it into an env check.

There is no config-wide files directory any more. `files.directory` was removed
because nobody set it and the schemas carry their own `dir`; a local file a
publish commits with no `dir` of its own goes to `/public/val`.

A collection's `directory` is **required**. It used to default to `/public/val`,
which meant a gallery that had simply not said where it wanted its files shared a
directory with every other one — and `images:check-unique-folder` (below) then
failed on a collision the author never chose.

This is why `s.imageset(galleryModule)` does not typecheck: `s.imageset()` _defines_ a
collection, it does not reference one. A field backed by a gallery is
`s.image(galleryModule)`.

### What to call one

The schema is `s.imageset()` / `s.fileset()`, so **imageset** and **fileset** are
the names to use in new code and new prose. Two older words are still in the
tree and mean the same thing: **gallery** (the UI components — `ModuleGallery`,
`FileGallery` — and most existing comments) and **collection** (older prose,
including parts of this file). The serialized `mediaType` is still `"images"` /
`"files"`, because it is a wire value inside stored patches and renaming it
needs a migration.

Four words for one concept is exactly what `terminology.md` warns about.
Converging them is worth doing; it is a separate change from the rename.

A collection is a `RecordSchema` carrying a `mediaType` marker, **keyed by file
path**, whose values are metadata — `{width, height, mimeType, alt}` for images,
`{mimeType}` for files. It is the entire module:

```ts
export default c.define(
  "/content/gallery.val.ts",
  s.imageset({ dir: "/public/img" }),
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

A **gallery-backed** field (`s.image(galleryModule)`, and `s.file(collectionModule)`
for the file pair) carries neither: the gallery has them, keyed by path, and
repeating them is how two copies of one fact get to disagree. `s.image(galleryVal)` refuses them at author time, and
validation refuses a path the gallery does not track. `fillFromGallery` supplies
them at resolve time.

**A gallery entry also holds DEFAULTS, and a field overrides them key by key.**
What a page chooses about a file — an image's `alt` and `hotspot`; a video's
`alt`, `hotspot`, `poster` + `posterTime`, `startTime`, `endTime` and
`captions` — can be set once on the gallery entry, and every field picked from
the gallery starts from it. A field that sets a key of its own wins for that
key only (`GALLERY_DEFAULT_GROUPS`): a field with its own `startTime` still
gets the gallery's `endTime`. Two groupings are deliberate: `poster` and
`posterTime` are one pair (the poster IS the frame at that time, so half from
each would describe a frame nobody chose), and `captions` is one list. A file
entry has none: `s.file()` has nothing authored to default.

`fillFromGallery` is the one merge, for the readers (`stegaEncode`) and the
Studio (`effectiveChoices` in `VideoChoices.tsx` runs the same groups), so a
page and the Studio cannot disagree about which poster a video has. Outside
draft mode a reader has no module sources to look in, so it reads the
gallery's PUBLISHED entries off the field's schema instance
(`Internal.media.galleriesOf`) — before that, a published page got a
gallery-backed value with nothing of the gallery's on it.

A gallery whose `alt` is a locale record holds an object rather than a string;
that is left in the gallery rather than copied into a field typed `string`,
and making the override locale-shaped is a separate change.

**An entry's `alt` type comes from the `alt` schema**, not from a fixed
`string | null`: `s.string()` gives `string`, `s.record(s.string())` gives
`Record<string, string>`, and an omitted or `.nullable()` alt gives
`string | null`. `ImagesetEntryMetadata` defaults to that last one, so plain
references keep working; `ImagesetEntryMetadata<AltSource>` is the any-alt form,
and it is what `s.image(galleryModule)` takes — a field carries its own alt and
never reads the gallery's, so any alt shape can back it. This was one type for
all three until it was fixed, which made the locale form impossible to type and
let `alt: null` compile against a required alt that then failed validation.

`patch_id` also appears on a media source whose bytes are not committed yet. It
is injected server-side, never authored, and `toExpression` drops it before
writing a `.val.ts` — a whole-object write built from the client's optimistic
view would otherwise print it into a user's file.

**There is no multi-valued gallery-backed field.** `s.image(module)` picks one
image from a gallery; nothing picks several. Adding it means a new schema type
(source shape, serialization, validation, UI, patch shape), not a small change.

## Where the bytes land

Three levels of precedence for a field:

1. the field's own `dir` (`s.image({ dir })`),
2. the `dir` of the gallery it references,
3. `/public/val` — the `createFilePatch` default.

For a collection it is always the schema's `dir`. `s.file()` has no
`dir` option at all (`FileOptions` is `{accept?}`), so a standalone file
field can only use 2 or 3.

The filename comes from `Internal.createFilename`: basename plus the first five
hex of the content hash, so `red-8x8.png` → `red-8x8_bfbd0.png`. Identical bytes
always produce the same ref.

## Re-encoding, and why it is a one-line seam

`s.image({ encode })` / `s.imageset({ encode })` convert an upload to WebP in the
**browser**, before it is uploaded. Off unless asked for; `{type: "webp"}` is
the whole opt-in, with `quality` (0.8), `maxWidth` and `maxHeight` (2560)
defaulted. A field inherits its gallery's setting the way it inherits `accept`
and `dir` — it has to, because `s.image(galleryVal)` serializes with
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

| state                                                     | where the bytes are  | URL                                    |
| --------------------------------------------------------- | -------------------- | -------------------------------------- |
| not served yet (created, saved, or committed and unbuilt) | the patch store      | `/api/val/files{path}?patch_id=…`      |
| served by a deployment                                    | the site's `/public` | `/public/x/y.png` served as `/x/y.png` |

`Internal.mediaUrl` is the one implementation of that rule — it was two functions
(`convertFileSource` / `convertRemoteSource`) split by a marker rather than by
anything about the answer.

`filePatchIds` is the map that decides, and its gate is **is the patch still in
the chain** — the same rule the edit's text follows. It has been got wrong twice,
each time by asking a question whose answer arrives before the file is at its
published URL:

- **saved** (`PUT /patches` succeeded): the bytes are in the patch store and at no
  published URL, so a just-uploaded image broke the moment its write came back;
- **committed** (`appliedAt`, or published by this client): true in `fs` mode,
  where `/save` writes `public/` and the dev server serves it at once, and false
  everywhere a build runs first. On a managed project the image vanished the
  moment Publish was pressed, stayed gone across a reload, and came back when the
  build went live.

A committed patch stays in the chain in `http` mode until a deployment moves the
base, and in `fs` mode `forgetPublished` removes it in the same step, so the
chain is the one test that is right in both. The bytes outlive it: the content
service releases a patch's files a day after its commit's deployment succeeded.

> `next dev` answers an uncommitted `/public` path with the app's HTML, so a
> broken tile still returns **200** with a `src` that looks right. Only decoding
> it — `naturalWidth > 0` — can tell. Any test here asserts on that.

## Why `/files` has no auth, and `/history/files` does

These two look like the same endpoint and are not, so they are documented
together — an "inconsistency" that gets tidied in either direction breaks
something.

**`/api/val/files` is unauthenticated on purpose, and cannot be otherwise.** A
draft image is fetched by the app's own backend during Next image optimisation.
That is a backend-to-backend request: no browser, no cookies, nothing to
authenticate with. Requiring auth would not tighten anything — it would black
out every unpublished image in the Studio the moment the app runs its images
through the optimiser.

What stands in for the credential is the `patch_id`. It is a UUID, so a
published path stays public (it already is) and an unpublished one is only
reachable by someone who already knows a patch id. The trade is written out in
full at the route itself in `ValServer.ts`; the short version is that guessing
one is infeasible, shimming it into a frontend is work, and the prize is an
image about to be published anyway.

**`/api/val/history/files` is authenticated**, and neither half of that argument
transfers to it:

- Its token is a **commit sha**, which is not a secret. It is in `git log`, in
  the GitHub UI, on every pull request. A sha cannot stand in for a credential
  the way a patch id does.
- Nothing fetches it server-side. Both callers are the Studio, in a browser that
  has the session cookie — the history pane's `<img>`, and `stageRestore`'s
  `fetch`, both same-origin so the cookie is sent. There is no optimiser path to
  keep open, so asking for auth costs nothing.

So: **`/files` open because it must be and can afford to be; `/history/files`
closed because it can be and should be.** Before changing either, check which of
those two properties you are relying on.

## Renaming a file

The Studio renames from two places: a gallery's file properties (the pencil
next to the name) and the **Rename** button of a standalone `s.image()` /
`s.file()` / `s.video()` field (a video stream: see "Renaming a video"). A gallery-backed field does not rename its file — the file is
shared with every other field that picked it — and its Rename sends you to the
gallery instead. The rules live in `packages/ui/spa/utils/renameMediaFile.ts`;
`useRenameMediaFile` is the part that talks to the stores.

**Only the base name changes.** The `_a1b2c` hash suffix and the extension are
locked (`Internal.createRenamedFilename`, which shares its cleaning with
`createFilename`, so renaming a file to the name it was uploaded with gives back
the name it has). The hash keeps two different files from sharing a name; the
extension is part of a remote file's validation hash and of how its bytes are
served. An existing suffix is kept as it is, even one that does not match the
bytes — locked has to mean kept. A hand-placed file with no suffix gets one from
its content hash, the way an upload would.

**Where the bytes are decides what moves**, and this is the part to get right:

| file                      | what a rename writes                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| local, published or draft | bytes fetched back from the URL the Studio shows, re-uploaded at the new path, and a `file` op with `null` that deletes the old one |
| remote, published         | a new ref and nothing else — no upload, no delete                                                                                   |
| remote, draft             | the bytes re-uploaded under the new ref, no delete                                                                                  |

Remote is that cheap because the content host stores bytes by hash
(`b/{bucket}/f/{hash}.{ext}`) and serves `…/f/{hash}/p/{path}` by hash and
extension alone (`remoteFileRoutes.ts` in `valbuild/home`): the path in a ref is
a label. A DRAFT still has to be re-uploaded, because the Studio finds its bytes
by the exact ref they were uploaded under (`filePatchIds`), so a new ref would
find nothing until publish. Publishing then PUTs the same hash twice; the second
gets a 409, which `uploadRemoteFile` counts as success.

The old local file is always deleted. A rename that left it would be a copy, and
the only way to clean up after one would be by hand — including for a
standalone field whose file some other standalone field happens to share,
which then has to be re-picked.

**A gallery rename rewrites every referrer, and only after the gallery patch has
landed** — a field must never name an entry before it exists. Referrers are
gallery-backed `s.image()` / `s.file()` fields AND the inline images of an
`s.richtext({ img: s.image(gallery) })`, which every reference scan
(`getFileReferrers`, `ReferenceStore`, `jsonValuesLoadRequirements`) now walks:
a scan that only looked for image fields walked straight past them, so a
gallery image used in rich text could also be deleted out from under it. Like
every rename, it refuses to run on a scan that cannot be complete
(`loadForReferenceScan`).

Two shapes from elsewhere in this file show up here:

- **A local key with remote bytes.** An upload through an
  `s.image(remoteGallery)` FIELD keys the gallery entry by the local path inside
  the ref, where an upload in the gallery keys it by the ref. `galleryKeyOf`
  resolves a referrer's path against the gallery's KEY SET, exact key first and
  the embedded path only when there is none — a gallery can hold both shapes
  for one file, and matching both would rename a field into the wrong entry.
  The rename treats such an entry as the remote file it is, per REFERRER: one
  entry can be named by several refs (the same file before and after the
  validation hash moved), so each draft ref is moved under its own new ref, and
  the rename is refused if any rewritten ref would resolve to a different entry.
- **A referrer with its own `patch_id`** (it uploaded the draft itself). The app
  reads a draft's URL off the field's own `patch_id`, never the gallery's, so
  that referrer's patch carries a `file` op too, for the server to stamp the new
  id on it.

A rename is a `move` of the record entry, which puts it last; `FileGallery`
therefore tracks the open file by ref, not by index, and follows it to the new
name.

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
publish gate. A **required alt** (`s.imageset({ alt: s.string().minLength(4) })`) is
blocking, and upload sets `alt: null` — so such a gallery is unpublishable until
someone types alt text. Correct, but it means uploading alone never reaches a
publishable state there.

## Fonts: `s.fontset()`

`s.fontset({ dir, accept? })` IS an `s.fileset()` — it serializes byte for byte
as one (`mediaType: "files"`), so every check, fix, rename, delete and the
`s.file(fontsVal)` field that picks from it are the fileset's, untouched. What
it adds is a default `accept` (`font/woff2,font/woff,font/ttf,font/otf`) and a
refusal of an `accept` that names anything but fonts.

**What makes a font a font is its mime type, not the set.** The Studio draws a
specimen of any file whose type is a font (`Internal.isFontMimeType`) — in a
gallery tile, the open entry, the picker of `s.file(fontsVal)`, and the field
once a font is chosen — so a font in a plain fileset previews too. A
set-backed field has no `mimeType` of its own, so the field asks the
extension. The Media nav calls a set "Fonts" when its `accept` is all fonts
(`isFontAccept`), the one place the set rather than the file is asked.

The specimen loads the file with `FontFace` under a family of our own and adds
it to `document.fonts`: an `@font-face` written inside the Studio's shadow root
is ignored by browsers, while the document's font set reaches every tree. A
remote font needs CORS for this, which the content host sends.

**Types come from the bytes.** Pickers type fonts unreliably — `.woff2` is
`font/woff2`, an empty type (read as `application/octet-stream`) or a pre-RFC
8081 `application/x-font-*`, by platform. The type decides the stored
`mimeType` and the filename's extension (`createFilename`), so `readFile`
retypes a font's data URL from its signature (`sniffFontMimeType`: `wOF2`,
`wOFF`, `OTTO`, `0x00010000`/`true`, `ttcf`) before anything is hashed. The
file input's `accept` also lists the extensions (`inputAccept`), and a drop is
matched by extension when the browser gave no usable type. The extension table
itself was moved to the `font/` types; a stored legacy name is still accepted
as matching its extension (`canonicalFontMimeType`).

**There is no conversion to WOFF2.** WOFF2 is Brotli-compressed, and of the
browsers only Safari offers Brotli in `CompressionStream`; anywhere else it
needs a WASM encoder, which is a dependency. WOFF (zlib, which every browser
has) could be written without one, but it is the older and larger format, so
nothing is converted. A project that wants only WOFF2 says so with
`accept: "font/woff2"`.

## Video: `s.video()` and `s.videoset()`

A video is a third kind of media, and the one media value that names several
files. It comes in both shapes the others do: a field of its own
(`s.video()`), or a field that picks from a collection (`s.video(videosVal)`
over an `s.videoset()`) — see "A set of videos" below.

```ts
{ path: "/public/val/intro_3b9d7.mp4", mimeType: "video/mp4",   // or an HLS master playlist
  width: 1920, height: 1080, duration: 42.5,                    // read from the bytes
  alt, hotspot, posterTime, startTime, endTime,                 // authored
  poster: { path: "/public/val/intro-poster_1a2b3.webp", width, height, mimeType },
  captions: [{ path: "/public/val/intro-en_8f2a1.vtt", srclang: "en", label, kind, default }] }
```

**`mimeType` is required** on a video of its own: a page has to know whether
it holds an `.mp4` or an `.m3u8` before it can play it. (A set-backed field has
none — the set's entry has it, and the reader fills it in.)

**What tells a video from an image is its declared keys, not a required one.**
Every media source is "a `path` plus optional fields", so structurally an image
and a video are the same type. `IsVideoSource<T>` asks whether `posterTime` is
a key of `T` — every video source type declares it, no image type does — and
`StegaOfSource` / `JsonOfSource` ask it BEFORE the image arm. It used to be the
required `mimeType`; a set-backed field has no `mimeType` of its own, so that
sent it down the image arm and `useVal` handed a page an `Image`.

**Every file is its own media object with its own `patch_id`.** The video, the
poster and each caption track are uploaded by `file` ops whose `path` is the
FIELD and whose `nestedFilePath` (`["poster"]`, `["captions", "2"]`) says where
the `patch_id` goes. `ValOps` keys its patch-id injection by path AND nested
path — keyed by path alone, the poster's op overwrote the video's and one of
the two drafts would not resolve. `resolveVideo` is the one implementation of
"a URL for each of them"; stega tags only the video's own `url`.

**Editing is per property** (`add` on `posterTime`, `captions/1/label`, ...),
never a whole-value replace, so `schemaTypesOfPath` lets a patch path continue
below a video. Only a new upload replaces the whole value, and it keeps `alt`,
`hotspot` and `captions` (a replaced video is usually the same video re-cut)
but drops the times and the poster, which are positions in the old file.

### Streaming

`s.video({ stream: { type: "hls" } })` makes the Studio convert an upload to
HLS **in the browser**, in `utils/video/transcode.worker.ts`: mediabunny over
WebCodecs, one H.264 rendition per height in `renditions` that fits the upload
(never an upscale), AAC audio, CMAF with `singleFilePerPlaylist` so a rendition
is two files (playlist + byte-ranged media) rather than hundreds of segments.
The converter is a lazy chunk of the Studio bundle — an app installs nothing,
and an editor downloads it only when they upload to a streaming field. AAC
encoding is missing from several browsers' WebCodecs, so mediabunny's WASM AAC
encoder is loaded in exactly that case.

Where the browser cannot (no WebCodecs — which includes every insecure context
— or no H.264 encoder), the ORIGINAL file is uploaded and the field says so.
`stream` is a request, not a guarantee, which is why validation accepts an mp4
in a streaming field and does not hold an HLS playlist to `accept` (`accept` is
what an editor may pick; the playlist is what the Studio made of it).

The stream is a directory named like a file would be — `${dir}/${name}_${hash5}/`
holding `master.m3u8`, `playlist-N.m3u8` and `segments-N.mp4` — and the field's
`path` is the master playlist.

- **Local**: the playlists name their siblings RELATIVELY, so a published
  stream is just static files. A DRAFT is served by `/api/val/files?patch_id=…`,
  and a relative name resolved against that URL loses the query; so `/files`
  rewrites a draft playlist as it serves it, pointing every URI at the draft
  endpoint with the same `patch_id`.
- **Remote**: the content host serves a file by its hash, so a relative name
  resolves to nothing there. `createVideoPatch` places the files bottom-up —
  segments, then media playlists rewritten to name the segments' refs, then
  the master — and each playlist's ref is the hash of its REWRITTEN bytes.

Seeking, Safari playback at all, and byte-ranged HLS need **Range requests**:
`/api/val/files` answers them, and so does the content host's `/file/...`
route (valbuild/home).

### Reading one in an app

`ValVideo` (Next and TanStack) renders the poster, the caption tracks, the
start/end (seek on load, pause at the end, plus a `#t=` fragment for a
progressive file) and the hotspot as `object-position`. hls.js is the APP's
dependency, passed in as `hls={() => import("hls.js")}` and called only for a
stream in a browser that cannot play one natively.

### The CLI: metadata and moving between local and remote

`video:add-metadata` reads the size and length of a local file with small
parsers in `@valbuild/server` — mp4/mov boxes (`isoBmff.ts`), WebM/Matroska
headers (`ebml.ts`) and HLS playlists (`hls.ts`) — so an app's server gets no
media library. They read headers only, never the frames. A file that does not
declare its length (a browser recording, a fragmented mp4 without `mehd`) gets
its size and a message to add the duration by hand.

A REMOTE video is read the same way, over HTTP, without being downloaded
(`remoteVideoMetadata.ts`). The parsers are synchronous and ask a `ByteSource`
for bytes; for a remote file that source is a cache of `Range` responses, and
a read it cannot answer throws, the missing range is fetched (with 64 KB of
read-ahead), and the parser runs again from the start. Re-parsing headers is
microseconds next to a request, and it keeps one parser for disk and remote.
An mp4 with `moov` first is one request; one with `moov` behind its frames is
about three, however large; an HLS stream is the master and one media
playlist. It relies on the content host answering `Range` — `/file/...` in
valbuild/home does — and a host that ignores it still works, by sending the
whole file once. So core asks for a remote video's metadata like a local
one's (`video:add-metadata`, `videos:add-metadata` for a set entry).

`video:upload-remote` / `video:download-remote` move EVERY file the video
names, in one fix (`videoRemote.ts`). Validation reports it as one error for
the whole video whichever file is on the wrong side — a remote video with a
local poster is half a migration, not a choice. Upward, the stream is placed
bottom-up exactly as the Studio places an upload (playlists rewritten to name
refs); downward, playlists are rewritten back to relative names. The patch
rewrites each `path` in place with an `add`, so nothing authored is touched.
The upload session (token, project settings, bucket) is opened once per fix
(`remoteUpload.ts`), so a video's files share a bucket.

For a set (`videosetFixes.ts`): `videos:add-metadata` reads an entry's
file by its KEY; `videos:check-all-files` adds untracked videos and untracked
streams (one entry per master playlist) and drops entries whose file is gone
— a file named by any video field (a poster, a caption track) counts as
tracked, so they can share the set's directory; and `videos:upload-remote`
moves an entry's files and renames its key, rewriting every `s.video(set)`
field that names it in the same run (`otherModulePatches`). Both the CLI and
the Studio hash a set's upload against `Internal.videosetEntryVideoSchema`,
the one definition, so the two cannot name the same file by different refs.

### Renaming a video

A progressive video renames like any field's file (above). A stream's NAME is
its directory, so renaming one moves every file in it (`renameVideo.ts`): the
files are read back from where the player gets them — a served playlist names
the others relatively, through the draft endpoint, or by remote ref, and all
three are read back to the same `/public` path — the playlists are normalised
to relative names, and the stream is placed under the new directory with the
same `placeHls` an upload uses. Remote streams are re-placed too rather than
relabelled: a draft is found by the ref it was uploaded under, so inner refs
with old labels would send the draft endpoint to the wrong patch. Old local
files are deleted, as for any rename. Poster and captions keep their names.

### A set of videos: `s.videoset()`

```ts
const videosVal = c.define(
  "/content/videos.val.ts",
  s.videoset({ dir: "/public/val/videos", stream: { type: "hls" } }),
  {
    "/public/val/videos/intro_51df2.mp4": {
      mimeType: "video/mp4",
      width: 1280,
      height: 720,
      duration: 12.5,
      alt: null,
    },
    "/public/val/videos/intro_05198/master.m3u8": {
      mimeType: "application/vnd.apple.mpegurl",
      width: 1920,
      height: 1080,
      duration: 30,
      alt: null,
    },
  },
);
const page = s.object({ intro: s.video(videosVal) });
// page source: { intro: { path: "/public/val/videos/intro_51df2.mp4", startTime: 2 } }
```

The entry holds **what is true of the FILE** — type, size, length, the set's
alone — and, as defaults, **what a page chooses about it**: description,
poster, start and end, focal point, captions. A field overrides any of those
key by key (see "The shape" above), so one clip can open one page at 0:02 and
every other page where the set says, without being uploaded twice. Core
refuses a set-backed field that repeats `mimeType` / `width` / `height` /
`duration`, the same rule as an image and its gallery; it checks an entry's
defaults with the same checks as a field's own (`videoDefaults.ts`), and a
field's own start against the set's end (or the reverse) as the pair the page
will play.

**The entry's poster is the gallery's thumbnail.** There is no second still:
two pictures of one video would disagree. An upload into the set takes the
poster from the picked file before it goes anywhere (the same frame a field
upload takes), and an entry without one — uploaded before posters were stored
— gets one the first time it is opened in the gallery, if the gallery can be
written to. A stream needs it most: a tile can seek in a file to show a frame,
and cannot in a stream.

The Studio edits both sides with the same controls (`VideoChoices`): the
gallery's panel edits the entry's defaults, and a set-backed field shows the
set's value with "From gallery · Override" until it has its own, then
"Overridden · Use gallery's". An image field picked from a gallery does the
same for its description and focal point.

- **A stream is ONE entry, keyed by its master playlist.** The playlists and
  segments beside it belong to it: the gallery names it by its directory (as
  the picker does), a delete removes every file of it, and a rename moves the
  directory and rewrites every field naming it (`buildStreamEntryRenamePatches`).
- **Keys are exact.** An entry is keyed by exactly the `path` a field holds —
  the remote ref for a remote set — so there is one key to look up, not the
  two an image gallery has to try (`fillFromGallery` still tries both).
- **`stream`, `dir` and `accept` are the set's.** `s.video(set)` serializes
  none of them; the Studio reads them off the set, and `s.video(set, { stream:
false })` is the one override, as `encode` is for an image.
- **Uploading in a set-backed field adds to the set.** The bytes are filed at
  the FIELD (so the field carries the `patch_id` a page reads a draft's URL
  off), and the set's entry is written once they are up
  (`createSetBackedVideoPatch`). Uploading in the set itself files them at the
  entry (`createVideosetEntryPatch`). Both go through `prepareVideoUpload`, the
  one place a picked file is read and — when asked — converted.
- **A field's poster and captions are the field's files**, and live where the
  set's videos do: for a remote set, a local poster is `video:upload-remote`
  on the field, which moves the poster and captions and never the video.
- **An entry's poster and captions are the entry's files.** `check-all-files`
  counts them as tracked, `list-unused-files` as used, a gallery delete
  removes them, and `videos:upload-remote` moves them with the video — or
  alone, for an entry whose key is already remote (the error then carries the
  key, and the entry is rewritten under it). `--fix` does not MAKE a missing
  poster: that needs a video decoder, and the CLI has none; the Studio makes
  it in the browser.
- **A deserialized set-backed schema** (what the Studio validates with) knows
  which set it points at but not its entries, so it does not claim an entry is
  missing — the set's own module is validated anyway.

### What is not there yet

- Uploads still travel as base64 JSON like every other file, so a large video
  costs a third more on the wire. (Hashing does not block: `crypto.subtle`, or
  in an insecure context the JS hash fed a megabyte at a time.)
- **Ranges in http mode.** `/api/val/files` reads only the asked-for range in
  fs mode (`openBinaryFile`), but `ValOpsHttp` gets a draft from the content
  service whole, in a JSON body, so each range there still fetches the file.
  It needs a ranged file endpoint on the content service.

## Fixtures

`examples/next/content/` has one module per shape, each gallery shipping one
_committed_ entry so "can I see what is already there" is covered by the repo:

- `mediaFixtures.val.ts` — `s.imageset({ dir: "/public/test/subdir" })`
- `fileGallery.val.ts` — `s.fileset({ dir: "/public/test/files" })`
- `mediaFields.val.ts` — `s.image()`, `s.image({ dir })`,
  `s.image(gallery)`, `s.file()`, rich text whose images come from the gallery,
  and the same inside a union. Also the fixture
  the language server's media-path completion tests open as an unsaved buffer:
  those completions are schema-driven now, so they need a module `val.modules`
  actually registers.

`e2e/media.spec.ts` drives all of them, and `e2e/renameMedia.spec.ts` renames
in the gallery and in a field. The fixture images are real 8×8
solid-colour PNGs (74 bytes) rather than 1×1 transparent ones, so a broken tile is
visibly broken.
