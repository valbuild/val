---
"@valbuild/core": minor
"@valbuild/server": minor
"@valbuild/ui": minor
"@valbuild/shared": minor
"@valbuild/react": minor
"@valbuild/next": minor
"@valbuild/cli": minor
"@valbuild/language-server": minor
"@valbuild/init": minor
---

**Breaking: media is a plain object with a `path`.** `c.image`, `c.file` and
`c.remote` are removed. An image or file is written as the object it always
described:

```ts
// before
c.image("/public/val/hero_a1b2c.png", {
  width: 944,
  height: 944,
  mimeType: "image/png",
});

// after
{ path: "/public/val/hero_a1b2c.png", width: 944, height: 944,
  mimeType: "image/png" }
```

`alt` and `hotspot` move out of `metadata` and sit next to `path`. A field backed
by a gallery (`s.image(galleryVal)`) carries only `path` (plus `alt` / `hotspot`):
its dimensions and mime type live in the gallery, and it is now an error to
repeat them, or to point at a path the gallery does not track. Remote is no
longer a different kind of value, only a path outside `/public`.

Consumers read the fields directly — `img.url`, `img.path`, `img.width`,
`img.alt`, `img.hotspot`. There is no `metadata` object any more; `url` is the
only generated field. `Internal.convertFileSource` and
`Internal.convertRemoteSource` are replaced by `Internal.mediaUrl` /
`Internal.resolveMedia`, and `FILE_REF_PROP`, `FILE_REF_SUBTYPE_TAG`,
`RemoteSource` and `Internal.isFile` are gone.

**Upgrading a project:** `c.image(P, M)` becomes `{ path: P, ...M }`, and the
same for `c.file` / `c.remote`. If the metadata is lost in the process,
`npx val validate --fix` reads it back from the files. Note that publishing any
media field for the first time after upgrading rewrites its syntax in the
`.val.ts`, because the server writes the object literal the new shape prints.

Every remote validation hash changes, since the metadata that feeds it is no
longer nested: `image:check-remote` / `file:check-remote` re-derive them.

New in return: media can be written in a `*.val.json` entry of a
`.jsonValues()` record, and uploaded into one from the Studio. That was
impossible before — a `*.val.json` cannot contain a function call. And `alt` on a
gallery-backed field is now a per-image override: the gallery's alt is used when
the field has none.

**Left for later:** a gallery whose `alt` schema is a locale record
(`s.images({ alt: s.record(s.string(), s.string()) })`) holds an object, and the
per-field override is typed `string`. Such a gallery's alt is therefore not
filled in, and there is no way to override it per image. Making the override
follow the gallery's own alt schema is a separate change.
