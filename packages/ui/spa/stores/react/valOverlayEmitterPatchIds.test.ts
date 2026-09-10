import type { Json, PatchId } from "@valbuild/core";
import { withFilePatchIds } from "./ValOverlayEmitter";

const ids = (entries: Array<[string, string]>): ReadonlyMap<string, PatchId> =>
  new Map(entries.map(([path, id]) => [path, id as PatchId]));

/**
 * The host page turns a media source into a URL, and it needs `patch_id` to
 * reach for the patch endpoint instead of the committed `/public` path. The
 * Studio's own store never carries it, so the emitter has to add it — see
 * `withFilePatchIds`. Without this a freshly uploaded image is served from a
 * path that has no file behind it yet, and fails to load with no error.
 */
describe("withFilePatchIds", () => {
  const map = ids([["/public/val/photo_a1b2c.jpg", "patch-1"]]);

  test("stamps a media source whose bytes are still in a patch", () => {
    const source: Json = {
      hero: { image: { path: "/public/val/photo_a1b2c.jpg", width: 10 } },
    };
    const next = withFilePatchIds(source, map);
    expect(next).toEqual({
      hero: {
        image: {
          path: "/public/val/photo_a1b2c.jpg",
          width: 10,
          patch_id: "patch-1",
        },
      },
    });
  });

  test("reaches into arrays and records", () => {
    const source: Json = {
      "/": {
        sections: [
          { image: { path: "/public/val/photo_a1b2c.jpg" } },
          { title: "no media here" },
        ],
      },
    };
    const next = withFilePatchIds(source, map);
    expect(next).toEqual({
      "/": {
        sections: [
          {
            image: { path: "/public/val/photo_a1b2c.jpg", patch_id: "patch-1" },
          },
          { title: "no media here" },
        ],
      },
    });
  });

  /**
   * Reference stability is load-bearing: the receiving store compares what it
   * is handed against what it holds, and a fresh object per emission would
   * re-render every component reading the module on every keystroke.
   */
  test("returns the same object when nothing is stamped", () => {
    const source: Json = { hero: { image: { path: "/public/val/other.jpg" } } };
    expect(withFilePatchIds(source, map)).toBe(source);
    expect(withFilePatchIds(source, new Map())).toBe(source);
  });

  test("leaves a path the map does not know alone", () => {
    const source: Json = { link: { path: "/some/route" } };
    expect(withFilePatchIds(source, map)).toBe(source);
  });

  test("a published file is not stamped, because the map excludes it", () => {
    // `filePatchIds` drops a patch once its bytes are at the committed path;
    // this asserts the emitter adds nothing of its own on top of that rule.
    const source: Json = { image: { path: "/public/val/photo_a1b2c.jpg" } };
    expect(withFilePatchIds(source, new Map())).toBe(source);
  });
});
