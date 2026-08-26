import { c, s } from "../val.config";

/**
 * The media upload paths, as fixtures the Studio and the e2e suite can drive.
 *
 * Four shapes, because they are four different code paths and each has had its
 * own bugs:
 *
 * - `s.images()` with a directory that is NOT the default, which is where the
 *   ref is built from `schema.directory` rather than from `/public/val`,
 * - `s.files()`, which goes through the same gallery with `imageMode` off,
 * - a single `s.image()` field, which builds its patch in `FileField` instead,
 * - a single `s.file()` field, the same path with a different subtype.
 *
 * Started empty on purpose: an upload into an empty record is the case where
 * nothing else in the module can mask a wrong ref.
 *
 * NOTE: `export default c.define(...)` has to be written INLINE. Assigning to a
 * const and exporting that (`export default gallerySubdir`) loads and validates
 * fine and then fails at publish — the server rewrites the `.val.ts` through its
 * AST and refuses with "Expected default expression to be a call expression",
 * having already written nothing. Cost me a publish to find.
 */
export default c.define(
  "/content/mediaFixtures.val.ts",
  s.images({
    // Deliberately not `/public/val`: a gallery that stores somewhere else is
    // the case the default silently swallows.
    directory: "/public/test/subdir",
  }),
  {
    "/public/test/subdir/red-8x8_bfbd0.png": {
      width: 8,
      height: 8,
      mimeType: "image/png",
      alt: null,
    },
  },
);
