/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { VERSION_PLACEHOLDER } = require("./buildPlaceholders");
const {
  writeStatic,
  routesOf,
  IMMUTABLE,
  FALLBACK_CACHE_CONTROL,
} = require("./buildStatic");

/** A Vite output folder shaped like the Studio's. */
function spaBuild() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "val-ui-static-"));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  };
  write(
    "assets/index-AAAA.js",
    `export const VERSION = "${VERSION_PLACEHOLDER}";`,
  );
  write("assets/chunk-BBBB.js", "export const x = 1;");
  write("assets/index-CCCC.css", "body{}");
  write("index.html", "<script src=/api/val/static/assets/index-AAAA.js>");
  // Not valid utf-8: must come out byte for byte.
  write("sample-video.mp4", Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x81]));
  return dir;
}

describe("writeStatic", () => {
  const made = [];
  afterAll(() => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
  });

  test("writes every file, substitutes the version in text, and copies binaries as they are", () => {
    const input = spaBuild();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "val-ui-static-out-"));
    made.push(input, out);
    const manifest = writeStatic({
      inputDir: input,
      outDir: out,
      version: "9.9.9",
    });

    expect(
      fs.readFileSync(path.join(out, "files/assets/index-AAAA.js"), "utf-8"),
    ).toBe(`export const VERSION = "9.9.9";`);
    const video = fs.readFileSync(path.join(out, "files/sample-video.mp4"));
    expect([...video]).toEqual([0x00, 0xff, 0xfe, 0x80, 0x81]);

    expect(manifest.version).toBe("9.9.9");
    expect(manifest.files["/sample-video.mp4"]).toEqual({
      sha256: crypto.createHash("sha256").update(video).digest("hex"),
      size: 5,
      contentType: "video/mp4",
    });
    expect(manifest.files["/assets/index-CCCC.css"].contentType).toBe(
      "text/css",
    );
    expect(manifest.fallback).toEqual({
      file: "/index.html",
      cacheControl: FALLBACK_CACHE_CONTROL,
    });
    expect(
      JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf-8")),
    ).toEqual(manifest);
  });

  test("refuses an output with no main chunk", () => {
    const input = spaBuild();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "val-ui-static-out-"));
    made.push(input, out);
    fs.rmSync(path.join(input, "assets/index-AAAA.js"));
    expect(() =>
      writeStatic({ inputDir: input, outDir: out, version: "9.9.9" }),
    ).toThrow(/main chunk/);
  });
});

describe("routesOf", () => {
  test("serves the app, its stylesheet and its siblings under the version, and every file at its own path", () => {
    const routes = routesOf(
      "9.9.9",
      [
        "/assets/index-AAAA.js",
        "/assets/chunk-BBBB.js",
        "/assets/index-CCCC.css",
        "/index.html",
      ],
      "/assets/index-AAAA.js",
      "/assets/index-CCCC.css",
    );
    expect(routes["/9.9.9/app"]).toEqual({
      file: "/assets/index-AAAA.js",
      cacheControl: IMMUTABLE,
    });
    expect(routes["/9.9.9/spa/index.css"].file).toBe("/assets/index-CCCC.css");
    // Relative imports of the main chunk resolve next to /9.9.9/app.
    expect(routes["/9.9.9/chunk-BBBB.js"].file).toBe("/assets/chunk-BBBB.js");
    expect(routes["/assets/chunk-BBBB.js"].file).toBe("/assets/chunk-BBBB.js");
    expect(routes["/index.html"].file).toBe("/index.html");
    // Only assets are siblings of the app.
    expect(routes["/9.9.9/index.html"]).toBeUndefined();
  });
});
