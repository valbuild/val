import { c, s } from "../val.config";

/**
 * Single image FIELDS either side of the `encode` option.
 *
 * A pair, because off is the default: without `plain` beside `encoded`, an
 * encoder that converted unconditionally would look correct. The cap is far
 * below the 2560 default so a modest fixture still exercises the downscale.
 *
 * Its own module rather than two more fields on `mediaFields.val.ts`, which is
 * where they naturally belong. That module is what
 * `s.image(gallery) stores in the gallery's directory` drives, and that test
 * carries a pre-existing race: a gallery-backed upload writes a SECOND patch
 * (the gallery's metadata entry) from a `.then()` after the file op the test
 * waits on, and it re-asserts an empty chain straight after `discardAll` — which
 * only ever established that the chain REACHED zero. Growing the module it
 * drives was enough to push that over: measured, adding the fields there failed
 * 2 of 3 filtered runs, and the same runs are clean with them here.
 *
 * NOTE: `export default c.define(...)` has to be written INLINE — see the note
 * in `mediaFixtures.val.ts`.
 */
export default c.define(
  "/content/encodedFields.val.ts",
  s.object({
    encoded: s
      .image({ encode: { type: "webp", maxWidth: 400, maxHeight: 400 } })
      .nullable()
      .describe("An image field that re-encodes uploads to webp"),
    plain: s
      .image()
      .nullable()
      .describe("An image field that uploads what it is given"),
  }),
  { encoded: null, plain: null },
);
