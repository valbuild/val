# Val Codebase Instructions

Instructions for AI assistants working with the Val content management system codebase.

## General rules

1. Never add @ts-expect-error unless explicitly being allowed to do so
2. Never use as any unless explicitly being allowed to do so
3. Ask if you need to use type assertions (`as Something`) - we try to avoid those

## Type System Architecture

### Core Type Hierarchy

Val has a dual type system: **Source** types define data shape, **Selector** types is the user facing types.

```
Source (data)          →  Selector (access)
─────────────────────────────────────────────
ImageSource            →  ImageSelector
FileSource<M>          →  FileSelector<M>
RemoteSource<M>        →  GenericSelector
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
  | RemoteSource
  | FileSource
  | ImageSource
  | RichTextSource<RichTextOptions>;
```

**SelectorSource** (`packages/core/src/selector/index.ts`):

```typescript
export type SelectorSource =
  | SourcePrimitive
  | undefined
  | readonly SelectorSource[]
  | { [key: string]: SelectorSource }
  | ImageSource
  | FileSource
  | RemoteSource
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
  | ImageSource  // Add missing type here
```

If you see `Type 'X' does not satisfy the constraint 'Source'`, the fix is almost always adding a type to `SelectorSource`, NOT using intersections.

## Schema System

### Schema-Source Relationship

Each Schema class validates and types its corresponding Source type:

| Schema              | Source              | Factory               |
| ------------------- | ------------------- | --------------------- |
| `ImageSchema<T>`    | `ImageSource`       | `s.image()`           |
| `FileSchema<T>`     | `FileSource`        | `s.file()`            |
| `RichTextSchema<O>` | `RichTextSource<O>` | `s.richtext(options)` |
| `ObjectSchema<T>`   | `SourceObject`      | `s.object({...})`     |
| `ArraySchema<T>`    | `SourceArray`       | `s.array(schema)`     |

## Module System

### c.define() Pattern

```typescript
c.define(
  "/content/page.val.ts",  // Module path
  s.object({...}),          // Schema
  { ... }                   // Source data matching schema
)
```

### Source Constructors

```typescript
c.image("/public/val/logo.png", {
  width: 100,
  height: 100,
  mimeType: "image/png",
});
c.file("/public/val/doc.pdf", { mimeType: "application/pdf" });
c.remote("https://...", { mimeType: "image/jpeg" });
```

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

## Working with Images

### ImageSource Shape

An `ImageSource` at runtime is:

```typescript
{
  _ref: string;          // FILE_REF_PROP — path like "/public/val/photo_a1b2c.jpg"
  _type: "file";         // VAL_EXTENSION
  _tag: "image";         // FILE_REF_SUBTYPE_TAG
  metadata?: ImageMetadata;  // { width, height, mimeType, alt, hotspot }
  patch_id?: string;     // set on uncommitted/draft images
}
```

Defined in `packages/core/src/source/image.ts`. Constants `FILE_REF_PROP`, `FILE_REF_SUBTYPE_TAG` are in `packages/core/src/source/file.ts`.

### Creating an Image Patch

There are two distinct patch shapes depending on context:

#### A) Single image field (`ImageField`)

Use `createFilePatch` from `packages/ui/spa/components/fields/FileField.tsx`. It returns a `Patch` with two ops:

1. **`replace`** — sets the field value to the new `ImageSource` object (`_ref`, `_type`, `_tag`, `metadata`)
2. **`file`** — carries the binary data (base64 data URL string), `filePath` (the `_ref`), and `metadata`

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
);
```

When the field has a `referencedModule` (gallery-backed), after uploading the image patch you also need to add the metadata entry to the gallery module via `addModuleFilePatch(referencedModule, [{op: "add", path: [filePath], value: metadata}], "record")`.

#### B) Gallery module (`ModuleGallery`)

In `ModuleGallery` (`packages/ui/spa/components/fields/ModuleGallery.tsx`), patches are built inline without `createFilePatch`. The gallery stores images as a record keyed by `_ref`:

```typescript
// Adding an image to a gallery
const patch: Patch = [
  {
    op: "add",
    path: [...patchPath, ref], // ref is the _ref / file path key
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

Key difference: the `replace` op is an `add` (adding a new record entry), and the `value` is the flat metadata object (not a full `ImageSource`).

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

**Selecting from a gallery** (via `ModuleMediaPicker`) uses a plain `replace` with the full `ImageSource` shape — no `file` op needed since the binary already exists in the gallery module:

```typescript
addPatch(
  [
    {
      op: "replace",
      path: patchPath,
      value: {
        [FILE_REF_PROP]: entry.filePath,
        [VAL_EXTENSION]: "file",
        [FILE_REF_SUBTYPE_TAG]: "image",
        metadata: entry.metadata,
      },
    },
  ],
  "image",
);
```

#### Ref computation for remote files

Both `ImageField` and `ModuleGallery` compute the `_ref` differently for remote vs local:

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

There are three approaches depending on context:

#### A) Core conversion functions

Use `Internal.convertFileSource` (for local `_type: "file"` images) or `Internal.convertRemoteSource` (for `_type: "remote"` images). Both are on the `Internal` object from `@valbuild/core`.

**URL rules for local images** (`convertFileSource` in `packages/core/src/schema/file.ts`):

| State                     | `_ref`                  | URL                                                |
| ------------------------- | ----------------------- | -------------------------------------------------- |
| Published (no `patch_id`) | `/public/val/photo.jpg` | `/val/photo.jpg` (strips `/public`)                |
| Draft (has `patch_id`)    | `/public/val/photo.jpg` | `/api/val/files/public/val/photo.jpg?patch_id=...` |
| Non-public ref            | `some/other/path`       | `some/other/path` (used as-is)                     |

**URL rules for remote images** (`convertRemoteSource` in `packages/core/src/schema/remote.ts`):

| State                     | URL                                                          |
| ------------------------- | ------------------------------------------------------------ |
| Published (no `patch_id`) | The `_ref` string directly (full remote URL)                 |
| Draft (has `patch_id`)    | `/api/val/files/{filePath}?patch_id=...&remote=true&ref=...` |

#### B) `ImageField` / full `ImageSource` objects

When you have an `ImageSource` object (with `_ref`, `_type`, etc.), use `useFilePatchIds()` to look up the `patch_id` for uncommitted patches, then call the appropriate convert function:

```typescript
const filePatchIds = useFilePatchIds();
const patchId = filePatchIds.get(source[FILE_REF_PROP]);
const url =
  source[VAL_EXTENSION] === "remote"
    ? Internal.convertRemoteSource({
        ...source,
        [VAL_EXTENSION]: "remote",
        ...(patchId ? { patch_id: patchId } : {}),
      }).url
    : Internal.convertFileSource({
        ...source,
        [VAL_EXTENSION]: "file",
        ...(patchId ? { patch_id: patchId } : {}),
      }).url;
```

#### C) `ModuleGallery` / bare `_ref` strings

In gallery contexts you often only have the `_ref` string (the record key), not a full `ImageSource`. Use the `refToUrl` helper pattern from `ModuleGallery.tsx` or `ModuleMediaPicker`:

```typescript
function refToUrl(
  ref: string,
  filePatchIds: ReadonlyMap<string, string>,
): string {
  const patchId = filePatchIds.get(ref);
  let filePath = ref;
  const remoteRefRes = Internal.remote.splitRemoteRef(ref);
  if (remoteRefRes.status === "success") {
    filePath = `/${remoteRefRes.filePath}`;
  }
  if (patchId) {
    return filePath.startsWith("/public")
      ? `/api/val/files${filePath}?patch_id=${patchId}`
      : `${filePath}?patch_id=${patchId}`;
  }
  return ref.startsWith("/public") ? filePath.slice("/public".length) : ref;
}
```

This handles both local and remote refs, with or without pending patches. The `MediaPicker` component accepts a `getUrl` prop using the same logic.

#### D) In selectors (consumer code)

`ImageSelector` extends `FileSelector` which has a `.url` property. The selector proxy (`SelectorProxy.ts`) automatically calls `convertFileSource` when it encounters a `_type: "file"` source, so `selector.url` just works.

#### Server-side file serving

The `/api/val/files` endpoint (`ValServer.ts`) serves draft files by loading them from the patch directory (via `getBase64EncodedBinaryFileFromPatch`) and published files directly from the filesystem (`getBinaryFile`). No auth is required on this endpoint (patch IDs serve as unguessable tokens).

## Common Fixes

### "Type 'X' does not satisfy constraint 'Source'"

→ Add the type to `SelectorSource` union in `packages/core/src/selector/index.ts`

### "Property 'X' does not exist on type 'never'"

→ Check if all variants are handled in conditional types (especially in `ImageNode`, `RichTextSource`)
