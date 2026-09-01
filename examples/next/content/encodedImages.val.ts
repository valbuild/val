import { c, s } from "../val.config";

/**
 * A gallery that asks for its uploads to be re-encoded.
 *
 * Deliberately a SEPARATE module from `mediaFixtures.val.ts` rather than an
 * option added to it: the existing media specs assert on exact uploaded refs,
 * hash and extension included, and turning encoding on there would change what
 * they upload. Keeping the two apart means the off-by-default path and the
 * converted path are both covered by tests that say what they mean.
 *
 * `maxWidth`/`maxHeight` are far below the 2560 default so a fixture that fits
 * on a laptop screen still exercises the downscale — the branch where the
 * encoded bytes win even if they are bigger.
 *
 * NOTE: `export default c.define(...)` has to be written INLINE — see the note
 * in `mediaFixtures.val.ts`.
 */
export default c.define(
  "/content/encodedImages.val.ts",
  s.images({
    directory: "/public/test/encoded",
    encode: { type: "webp", maxWidth: 400, maxHeight: 400 },
  }),
  {},
);
