import { Internal } from "..";
import {
  createRenamedFilename,
  sanitizeFilenameBase,
  stripHashSuffix,
} from "./filename";

const SHA = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("createRenamedFilename", () => {
  test("keeps the hash and the extension, and takes only the base", () => {
    // The space goes the way an upload's does: dropped, not escaped.
    expect(createRenamedFilename("Hero-Mountains", SHA, "jpg")).toBe(
      "hero-mountains_a1b2c.jpg",
    );
    expect(createRenamedFilename("Hero Mountains", SHA, "jpg")).toBe(
      "heromountains_a1b2c.jpg",
    );
  });

  test("does not repeat a hash the editor typed back in", () => {
    expect(createRenamedFilename("hero_a1b2c", SHA, "png")).toBe(
      "hero_a1b2c.png",
    );
  });

  test("refuses a name with nothing usable left in it", () => {
    expect(createRenamedFilename("  ", SHA, "png")).toBeNull();
    expect(createRenamedFilename("æøå", SHA, "png")).toBeNull();
  });

  test("a file with no extension stays without one", () => {
    expect(createRenamedFilename("readme", SHA, "")).toBe("readme_a1b2c");
  });

  test("names a file exactly as an upload under that name would", () => {
    // The point of sharing the helper: rename a file to the name it was
    // uploaded with, and it must come out with the name it already has.
    for (const name of ["Hero.png", "my photo.png", "logo_a1b2c.png"]) {
      const uploaded = Internal.createFilename(
        PNG_DATA_URL,
        name,
        { mimeType: "image/png", width: 1, height: 1 },
        SHA,
      );
      expect(
        createRenamedFilename(name.replace(/\.png$/, ""), SHA, "png"),
      ).toBe(uploaded);
    }
  });
});

describe("sanitizeFilenameBase", () => {
  test("lower-cases and drops what a URL would escape", () => {
    expect(sanitizeFilenameBase("Ærlig Talt!")).toBe("rligtalt!");
  });
});

describe("stripHashSuffix", () => {
  test("only strips the hash it was given", () => {
    expect(stripHashSuffix("photo_a1b2c", "a1b2c")).toBe("photo");
    expect(stripHashSuffix("photo_zzzzz", "a1b2c")).toBe("photo_zzzzz");
    expect(stripHashSuffix("photo", "a1b2c")).toBe("photo");
  });
});
