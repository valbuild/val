# Val Codebase Instructions

Instructions for AI assistants working with the Val content management system codebase.

## Read first

[`architecture/`](../architecture/README.md) holds the explanations that are
expensive to re-derive from the code:

- [`architecture/stores.md`](../architecture/stores.md) — the Studio's client
  state in one page: marks vs demand, the two realms, `peek`/`get`, and why
  reference stability is load-bearing.
- [`architecture/media.md`](../architecture/media.md) — `s.images()` / `s.files()`
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
```

Notes:

- `pnpm run build` at the root is NOT recursive — it only runs `preconstruct build && pnpm --filter @valbuild/ui build`. Do not use `pnpm -r build` to verify CI; recursive build pulls in example-project fixtures that aren't part of CI and have unrelated pre-existing issues.
- `examples/next` build is its own CI job and must be run separately. It is also the only job that type-checks with `next-env.d.ts` present, so a green `pnpm run -r typecheck` does not imply a green example build — see "'X' cannot be used as a JSX component" under Common Fixes.
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

`s.image({ encode: { type: "webp" } })` and `s.images({ encode })` convert an
upload to WebP in the browser before it is uploaded. **Off by default.**
`quality` defaults to 0.8, `maxWidth`/`maxHeight` to 2560, and `encode: false`
turns it off where a gallery turned it on.

The implementation is `packages/ui/spa/utils/encodeImage.ts`, called from
`readImageFromFile`. That is the only correct place for it: `createFilename`
derives the extension from the data URL's mime type, so swapping the bytes
before the hash makes the filename, `mimeType`, dimensions and remote validation
hash all follow — and swapping them after makes every one of those describe a
file that was never uploaded.

Things that will bite: `accept` beats `encode` (validation checks the stored
mimeType against `accept`); a bigger WebP loses to the original unless the image
was downscaled; SVG/GIF/AVIF are never converted; and `blob.type` must be
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
