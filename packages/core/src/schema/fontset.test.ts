import { initVal } from "../initVal";
import { SourcePath } from "../val";
import { DEFAULT_FONT_ACCEPT } from "../mimeType/font";

const { s, c } = initVal();

/** What validation says, minus the checks only the CLI can answer. */
function messages(
  result: false | Record<string, { message: string; fixes?: string[] }[]>,
): string[] {
  if (!result) return [];
  return Object.values(result)
    .flat()
    .filter(
      (e) =>
        !e.fixes?.some((f) =>
          [
            "files:check-unique-folder",
            "files:check-all-files",
            "file:check-metadata",
          ].includes(f),
        ),
    )
    .map((e) => e.message);
}

describe("s.fontset()", () => {
  test("is a fileset that accepts the web font formats", () => {
    const serialized = s
      .fontset({ dir: "/public/val/fonts" })
      ["executeSerialize"]();
    expect(serialized).toMatchObject({
      type: "record",
      mediaType: "files",
      accept: DEFAULT_FONT_ACCEPT,
      dir: "/public/val/fonts",
      remote: false,
    });
    expect(DEFAULT_FONT_ACCEPT).toBe("font/woff2,font/woff,font/ttf,font/otf");
  });

  test("serializes exactly as the fileset it is", () => {
    expect(
      s.fontset({ dir: "/public/val/fonts" })["executeSerialize"](),
    ).toEqual(
      s
        .fileset({ dir: "/public/val/fonts", accept: DEFAULT_FONT_ACCEPT })
        ["executeSerialize"](),
    );
  });

  test("a narrower accept is kept", () => {
    expect(
      s
        .fontset({ dir: "/public/val/fonts", accept: "font/woff2" })
        ["executeSerialize"](),
    ).toMatchObject({ accept: "font/woff2" });
  });

  test("an accept that is not fonts is refused", () => {
    expect(() =>
      s.fontset({ dir: "/public/val/fonts", accept: "font/woff2, image/png" }),
    ).toThrow(/image\/png/);
  });

  test(".remote() makes it remote", () => {
    expect(
      s.fontset({ dir: "/public/val/fonts" }).remote()["executeSerialize"](),
    ).toMatchObject({ remote: true });
  });

  test("files: { remote: true } makes it remote", () => {
    const remote = initVal({ files: { remote: true } });
    expect(
      remote.s.fontset({ dir: "/public/val/fonts" })["executeSerialize"](),
    ).toMatchObject({ remote: true });
  });

  test("validates every web font format, and refuses what it does not accept", () => {
    const schema = s.fontset({ dir: "/public/val/fonts" });
    const ok = schema["executeValidate"]("/fonts.val.ts" as SourcePath, {
      "/public/val/fonts/inter_a1b2c.woff2": { mimeType: "font/woff2" },
      "/public/val/fonts/inter_a1b2c.woff": { mimeType: "font/woff" },
      "/public/val/fonts/inter_a1b2c.ttf": { mimeType: "font/ttf" },
      "/public/val/fonts/inter_a1b2c.otf": { mimeType: "font/otf" },
    });
    expect(messages(ok)).toEqual([]);

    const bad = schema["executeValidate"]("/fonts.val.ts" as SourcePath, {
      "/public/val/fonts/report_a1b2c.pdf": { mimeType: "application/pdf" },
    });
    expect(messages(bad)).toEqual([
      `Mime type mismatch. Found 'application/pdf' but schema accepts '${DEFAULT_FONT_ACCEPT}'`,
    ]);
  });

  test("a field picks from it with s.file(fontsVal)", () => {
    const fontsVal = c.define(
      "/content/fonts.val.ts",
      s.fontset({ dir: "/public/val/fonts" }),
      { "/public/val/fonts/inter_a1b2c.woff2": { mimeType: "font/woff2" } },
    );
    const schema = s.object({ heading: s.file(fontsVal) });
    const pageVal = c.define("/content/page.val.ts", schema, {
      heading: { path: "/public/val/fonts/inter_a1b2c.woff2" },
    });
    expect(pageVal).toBeTruthy();
    expect(
      messages(
        schema["executeValidate"]("/content/page.val.ts" as SourcePath, {
          heading: { path: "/public/val/fonts/inter_a1b2c.woff2" },
        }),
      ),
    ).toEqual([]);
    expect(
      messages(
        schema["executeValidate"]("/content/page.val.ts" as SourcePath, {
          heading: { path: "/public/val/fonts/missing_a1b2c.woff2" },
        }),
      ).length,
    ).toBeGreaterThan(0);
  });

  test("a font in a plain s.file() agrees with its extension", () => {
    // `font/woff2` had no extension in the table and `.ttf` was the legacy
    // `application/x-font-ttf`, so a correctly typed font failed here.
    const schema = s.file({ accept: "font/*" });
    for (const [ext, mimeType] of [
      ["woff2", "font/woff2"],
      ["woff", "font/woff"],
      ["ttf", "font/ttf"],
      ["otf", "font/otf"],
    ]) {
      expect(
        messages(
          schema["executeValidate"]("/content/page.val.ts" as SourcePath, {
            path: `/public/val/inter_a1b2c.${ext}`,
            mimeType,
          }),
        ),
      ).toEqual([]);
    }
  });

  test("a font typed with a legacy name still agrees with its extension", () => {
    const schema = s.file();
    expect(
      messages(
        schema["executeValidate"]("/content/page.val.ts" as SourcePath, {
          path: "/public/val/inter_a1b2c.ttf",
          mimeType: "application/x-font-ttf",
        }),
      ),
    ).toEqual([]);
  });
});
