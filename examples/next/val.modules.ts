import { modules } from "@valbuild/next";
import { config } from "./val.config";

/**
 * Whether to include the remote-file example.
 *
 * Opt-in, because a remote schema is not free: the moment one exists anywhere in
 * the project, the Studio starts asking `/remote/settings` for a project id and a
 * bucket, and `/save` demands remote credentials for EVERY publish — including a
 * publish of plain text. Both need a login this app does not have by default, so
 * registering the module unconditionally would leave a plain `pnpm dev` logging
 * failed requests and unable to publish anything. (This held for a remote FIELD
 * before `hasRemoteFileSchema` was fixed to see remote galleries too; now it holds
 * for either.)
 *
 * `NEXT_PUBLIC_` because both halves have to agree: the server needs the schema
 * to validate and commit, and the Studio — which is handed `ValModules` in the
 * browser — needs it to render the gallery at all. Only `NEXT_PUBLIC_*` reaches
 * the client bundle. The `typeof` guard is for the CLI, which evaluates this file
 * in a `node:vm` sandbox where `process` may not exist.
 */
const remoteMedia =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_VAL_EXAMPLE_REMOTE_MEDIA === "true";

export default modules(config, [
  { def: () => import("./content/authors.val") },
  { def: () => import("./app/blogs/[blog]/page.val") },
  { def: () => import("./app/support/[slug]/page.val") },
  { def: () => import("./app/generic/[[...path]]/page.val") },
  { def: () => import("./content/media.val") },
  { def: () => import("./content/theme.val") },
  { def: () => import("./app/page.val") },
  { def: () => import("./app/external.val") },
  // Fixtures for the .jsonValues() walkthrough (docs/plans/jsonValues-walkthrough.md)
  { def: () => import("./content/kb.val") },
  { def: () => import("./content/jsonEntryMedia.val") },
  { def: () => import("./content/tags.val") },
  { def: () => import("./content/featuredContent.val") },
  // A handbook: chapters of sections, with a `select` at BOTH array levels —
  // the shape the store benchmark measures against, in an app that really builds
  // and really validates. Small on purpose; see scripts/handbook-fixture.mjs.
  { def: () => import("./content/handbook.val") },
  // The media upload paths: a gallery in a non-default directory, a files
  // gallery, and single image/file fields. See content/mediaFixtures.val.ts.
  { def: () => import("./content/mediaFixtures.val") },
  { def: () => import("./content/fileGallery.val") },
  { def: () => import("./content/mediaFields.val") },
  // `hidden()` and `readonly()`, which the Studio is the only thing enforcing.
  { def: () => import("./content/access.val") },
  // Lists of primitives, the one shape the compare view diffs by content.
  { def: () => import("./content/lists.val") },
  // A plain router read from a SERVER component — see app/notes/[note]/page.val.ts.
  { def: () => import("./app/notes/[note]/page.val") },
  // A gallery backed by Val's remote file host, when it is switched on. See
  // `remoteMedia` above, and content/remoteImages.val.ts for why this is a
  // gallery rather than a single remote image field.
  // Last, because a conditional spread reads as the tail of the list.
  ...(remoteMedia ? [{ def: () => import("./content/remoteImages.val") }] : []),
]);
