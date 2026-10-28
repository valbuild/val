import { galleryNewEntries } from "./galleryNewEntries";

describe("galleryNewEntries", () => {
  const published = new Set(["/public/val/a.png", "/public/val/b.png"]);

  test("an entry the published record does not have is new", () => {
    expect(
      galleryNewEntries({
        current: [
          "/public/val/a.png",
          "/public/val/b.png",
          "/public/val/c.png",
        ],
        published,
        patches: [],
        patchPath: [],
      }),
    ).toEqual(new Set(["/public/val/c.png"]));
  });

  test("a published entry renamed is not new, however many renames it took", () => {
    expect(
      galleryNewEntries({
        current: ["/public/val/a.png", "/public/val/b3.png"],
        published,
        patches: [
          [
            {
              op: "move",
              from: ["/public/val/b.png"],
              path: ["/public/val/b2.png"],
            },
          ],
          [
            {
              op: "move",
              from: ["/public/val/b2.png"],
              path: ["/public/val/b3.png"],
            },
          ],
        ],
        patchPath: [],
      }),
    ).toEqual(new Set());
  });

  test("an upload renamed before publishing is still new", () => {
    expect(
      galleryNewEntries({
        current: [
          "/public/val/a.png",
          "/public/val/b.png",
          "/public/val/d.png",
        ],
        published,
        patches: [
          [
            {
              op: "add",
              path: ["/public/val/c.png"],
              value: { mimeType: "image/png" },
            },
          ],
          [
            {
              op: "move",
              from: ["/public/val/c.png"],
              path: ["/public/val/d.png"],
            },
          ],
        ],
        patchPath: [],
      }),
    ).toEqual(new Set(["/public/val/d.png"]));
  });

  test("moves are read relative to where the record is in its module", () => {
    expect(
      galleryNewEntries({
        current: ["/public/val/a.png", "/public/val/b2.png"],
        published,
        patches: [
          [
            {
              op: "move",
              from: ["images", "/public/val/b.png"],
              path: ["images", "/public/val/b2.png"],
            },
          ],
        ],
        patchPath: ["images"],
      }),
    ).toEqual(new Set());
  });

  test("nothing is new while the published record is still loading", () => {
    expect(
      galleryNewEntries({
        current: ["/public/val/c.png"],
        published: null,
        patches: [],
        patchPath: [],
      }),
    ).toEqual(new Set());
  });
});
