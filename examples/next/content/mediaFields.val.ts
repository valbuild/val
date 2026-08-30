import { c, s } from "../val.config";
import mediaGalleryVal from "./mediaFixtures.val";

/**
 * Single media FIELDS, and the shapes that have broken them.
 *
 * `FileField` and `ImageField` build their own patch (a `replace` carrying the
 * whole `ImageSource`, plus a `file` op) rather than the gallery's `add`, so they
 * are a separate path from `ModuleGallery` and need separate coverage.
 *
 * Every field here starts NULL on purpose. An empty field is the case that used
 * to crash the Studio outright: both components ran a `useMemo` below their
 * `not-found` / `loading` guards, so a field with no value took an early return
 * on the first render and ran more hooks on the second — "Rendered more hooks
 * than during the previous render", from inside `useMemo`, with nothing in the
 * message about media.
 */
export default c.define(
  "/content/mediaFields.val.ts",
  s.object({
    /** The plain case. Uploads land in `createFilePatch`'s `/public/val`. */
    image: s.image().nullable(),
    /**
     * A field that chooses its own directory.
     *
     * `ImageField` only ever read the directory of a REFERENCED module, so this
     * silently wrote to `/public/val` — outside the directory the schema names.
     */
    imageInSubdir: s
      .image({ directory: "/public/test/fields" })
      .nullable()
      .describe("An image field with its own directory"),
    /** Gallery-backed: the picker offers what the gallery holds. */
    fromGallery: s.image(mediaGalleryVal).nullable(),
    /**
     * A field that asks for its uploads to be re-encoded.
     *
     * The counterpart of `image` above, which does not: off is the default, so
     * only a pair proves that the option is what decides rather than something
     * ambient. The cap is small so a modest fixture still downscales.
     */
    imageEncoded: s
      .image({ encode: { type: "webp", maxWidth: 400, maxHeight: 400 } })
      .nullable()
      .describe("An image field that re-encodes uploads to webp"),
    /** The file counterpart. `s.file()` has no `directory` option. */
    file: s.file().nullable(),
    /**
     * Media inside a UNION, which is where fields are hardest: the branch is
     * chosen by a discriminator, so the image field mounts and unmounts as the
     * branch changes — and a field that mounts with no value is exactly the
     * crash above.
     */
    sections: s.array(
      s.union(
        "type",
        s.object({ type: s.literal("text"), text: s.string() }),
        s.object({ type: s.literal("image"), image: s.image() }),
        s.object({
          type: s.literal("fromGallery"),
          image: s.image(mediaGalleryVal),
        }),
        s.object({ type: s.literal("file"), file: s.file() }),
      ),
    ),
  }),
  {
    image: null,
    imageInSubdir: null,
    imageEncoded: null,
    fromGallery: null,
    file: null,
    sections: [],
  },
);
