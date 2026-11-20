import { groupByDirectory } from "./MediaPanel";
import { ShellMediaFile } from "./types";

const file = (ref: string): ShellMediaFile => ({
  ref,
  sourcePath: `/content/media.val.ts?p=${JSON.stringify(ref)}`,
});

/**
 * How a gallery's files are grouped.
 *
 * A gallery is constrained to one directory, but files under it can sit in
 * subdirectories — so the panel groups by where they are rather than showing
 * one flat list of names. The labels are relative to the gallery's own
 * directory, because that directory is on the row above and repeating it on
 * every heading pushes the part that differs off the end -- and the files
 * directly in it have no heading at all.
 */
describe("groupByDirectory", () => {
  test("files at the top of the gallery are one group, with no heading", () => {
    const groups = groupByDirectory(
      [file("/public/val/images/a.png"), file("/public/val/images/b.png")],
      "/public/val/images",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
    expect(groups[0].files).toHaveLength(2);
  });

  test("a gallery directory written with a trailing slash is the same directory", () => {
    const groups = groupByDirectory(
      [file("/public/val/images/a.png")],
      "/public/val/images/",
    );
    expect(groups[0].label).toBeNull();
  });

  test("a remote file is grouped by the directory it was uploaded into", () => {
    // The ref is a URL. Grouped by the URL's own directory, the remote file
    // got a heading that was the whole URL, and the local files one that
    // said "In this folder".
    const remote =
      "https://ce1d5d1.valstart.dev/_val/file/p/ce1d5d1/b/r2/v/0.150.3/h/50d3/f/561cff11fe18/p/public/val/images/hero_a1b2c.png";
    const groups = groupByDirectory(
      [file("/public/val/images/a.png"), file(remote)],
      "/public/val/images",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
    expect(groups[0].files.map((entry) => entry.ref)).toEqual([
      "/public/val/images/a.png",
      remote,
    ]);
  });

  test("a remote file in a subdirectory is grouped with that subdirectory", () => {
    const remote =
      "https://remote.val.build/file/p/proj/b/r2/v/0.150.3/h/50d3/f/561cff11fe18/p/public/val/images/portraits/ada_a1b2c.jpg";
    const groups = groupByDirectory(
      [file("/public/val/images/portraits/ida.jpg"), file(remote)],
      "/public/val/images",
    );
    expect(groups.map((group) => group.label)).toEqual(["portraits"]);
    expect(groups[0].files).toHaveLength(2);
  });

  test("a subdirectory is its own group, named relatively", () => {
    const groups = groupByDirectory(
      [
        file("/public/val/images/a.png"),
        file("/public/val/images/portraits/ada.jpg"),
        file("/public/val/images/portraits/ida.jpg"),
      ],
      "/public/val/images",
    );
    expect(groups.map((group) => group.label)).toEqual([null, "portraits"]);
    expect(groups[1].files.map((entry) => entry.ref)).toEqual([
      "/public/val/images/portraits/ada.jpg",
      "/public/val/images/portraits/ida.jpg",
    ]);
  });

  test("nested subdirectories keep their whole relative path", () => {
    // Flattening `legal/eu` to `eu` would put two different folders under one
    // heading whenever a gallery has both.
    const groups = groupByDirectory(
      [file("/public/val/docs/legal/eu/dpa.pdf")],
      "/public/val/docs",
    );
    expect(groups[0].label).toBe("legal/eu");
  });

  test("a file outside the gallery's directory keeps its full path", () => {
    // It should not happen, but a gallery's record is data: a path that does
    // not sit under the directory is shown as it is rather than mangled by a
    // prefix that does not apply.
    const groups = groupByDirectory(
      [file("/public/other/stray.png")],
      "/public/val/images",
    );
    // Shown as it is served: `/public` is the web root, so a path outside the
    // gallery still reads the way a URL to it would.
    expect(groups[0].label).toBe("/other");
  });

  test("groups come out in a stable order", () => {
    const groups = groupByDirectory(
      [
        file("/public/val/images/z/one.png"),
        file("/public/val/images/a/two.png"),
        file("/public/val/images/top.png"),
      ],
      "/public/val/images",
    );
    expect(groups.map((group) => group.dir)).toEqual([
      "/public/val/images",
      "/public/val/images/a",
      "/public/val/images/z",
    ]);
  });
});
