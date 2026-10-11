import { initVal } from "../initVal";

/**
 * `s.imageset()`, `s.fileset()`, `s.fontset()` and `s.videoset()` are the
 * deprecated names of `s.imagedir()`, `s.filedir()`, `s.fontdir()` and
 * `s.videodir()`, which take the directory as their first argument instead of
 * as `dir`. A project that has not moved yet must get exactly the schema it
 * would get from the new name — byte for byte, since the serialized schema is
 * what the Studio, the CLI and the content host read.
 */
describe("deprecated *set names", () => {
  for (const remote of [false, true]) {
    describe(remote ? "with files: { remote: true }" : "local", () => {
      const { s } = initVal({ files: { remote } });

      test("s.imageset() is s.imagedir()", () => {
        expect(
          s
            .imageset({
              dir: "/public/val/images",
              accept: "image/webp",
              alt: s.string(),
              encode: { type: "webp" },
            })
            ["executeSerialize"](),
        ).toEqual(
          s
            .imagedir("/public/val/images", {
              accept: "image/webp",
              alt: s.string(),
              encode: { type: "webp" },
            })
            ["executeSerialize"](),
        );
        expect(
          s.imageset({ dir: "/public/val/images" })["executeSerialize"](),
        ).toEqual(s.imagedir("/public/val/images")["executeSerialize"]());
      });

      test("s.fileset() is s.filedir()", () => {
        expect(
          s
            .fileset({ dir: "/public/val/docs", accept: "application/pdf" })
            ["executeSerialize"](),
        ).toEqual(
          s
            .filedir("/public/val/docs", { accept: "application/pdf" })
            ["executeSerialize"](),
        );
      });

      test("s.fontset() is s.fontdir()", () => {
        expect(
          s.fontset({ dir: "/public/val/fonts" })["executeSerialize"](),
        ).toEqual(s.fontdir("/public/val/fonts")["executeSerialize"]());
        expect(
          s
            .fontset({ dir: "/public/val/fonts", accept: "font/woff2" })
            ["executeSerialize"](),
        ).toEqual(
          s
            .fontdir("/public/val/fonts", { accept: "font/woff2" })
            ["executeSerialize"](),
        );
      });

      test("s.videoset() is s.videodir()", () => {
        expect(
          s
            .videoset({
              dir: "/public/val/videos",
              stream: { type: "hls" },
              alt: s.string(),
            })
            ["executeSerialize"](),
        ).toEqual(
          s
            .videodir("/public/val/videos", {
              stream: { type: "hls" },
              alt: s.string(),
            })
            ["executeSerialize"](),
        );
      });
    });
  }
});
