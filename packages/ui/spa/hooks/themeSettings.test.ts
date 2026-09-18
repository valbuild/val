import { Json, THEME_RADIUS_STEPS } from "@valbuild/core";
import { NO_THEME_SETTINGS, readThemeSettings } from "./themeSettings";

describe("readThemeSettings", () => {
  test("an empty settings module says nothing", () => {
    expect(readThemeSettings({})).toEqual(NO_THEME_SETTINGS);
    expect(readThemeSettings(undefined)).toEqual(NO_THEME_SETTINGS);
  });

  test("reads a complete theme", () => {
    expect(
      readThemeSettings({
        theme: { accent: "#2563eb", radius: "tight", mode: "light" },
      }),
    ).toEqual({
      accent: "#2563eb",
      radius: "tight",
      mode: "light",
      logo: null,
    });
  });

  test("a partial theme leaves the rest unset", () => {
    // The normal case: an editor picks a colour and never touches the other
    // two.
    expect(readThemeSettings({ theme: { accent: "#2563eb" } })).toEqual({
      accent: "#2563eb",
      radius: null,
      mode: null,
      logo: null,
    });
  });

  test("null means unset, the same as absent", () => {
    expect(
      readThemeSettings({ theme: { accent: null, radius: null, mode: null } }),
    ).toEqual(NO_THEME_SETTINGS);
  });

  test("an empty accent is unset, not a colour", () => {
    expect(readThemeSettings({ theme: { accent: "   " } }).accent).toBe(null);
    expect(readThemeSettings({ theme: { accent: "" } }).accent).toBe(null);
  });

  test("every radius step the schema allows is read back", () => {
    for (const radius of THEME_RADIUS_STEPS) {
      expect(readThemeSettings({ theme: { radius } }).radius).toBe(radius);
    }
  });

  test("a radius step that does not exist is dropped", () => {
    // Not passed through: `THEME_RADIUS_LENGTHS["rounded"]` is `undefined`, and
    // `--radius: undefined` takes the whole declaration down rather than
    // falling back — every corner in the Studio would go square.
    expect(readThemeSettings({ theme: { radius: "rounded" } }).radius).toBe(
      null,
    );
    expect(readThemeSettings({ theme: { radius: 8 } }).radius).toBe(null);
  });

  test("a mode that is not one of the two is dropped", () => {
    expect(readThemeSettings({ theme: { mode: "auto" } }).mode).toBe(null);
    expect(readThemeSettings({ theme: { mode: true } }).mode).toBe(null);
  });

  test("survives a source that is not shaped like settings at all", () => {
    // A hand-edited settings file, or a module whose schema changed under it.
    // The Studio still has to render.
    expect(readThemeSettings("nonsense")).toEqual(NO_THEME_SETTINGS);
    expect(readThemeSettings([1, 2, 3])).toEqual(NO_THEME_SETTINGS);
    expect(readThemeSettings(null)).toEqual(NO_THEME_SETTINGS);
    expect(readThemeSettings({ theme: "blue" })).toEqual(NO_THEME_SETTINGS);
    expect(readThemeSettings({ theme: ["blue"] })).toEqual(NO_THEME_SETTINGS);
  });

  test("an accent that is not a hex is passed through, and handled downstream", () => {
    // Deliberate: `accentRamp` is the one place that decides what a usable
    // accent is, and it answers `null`. A second, weaker check here would be a
    // second definition of valid — and the weaker one would win.
    expect(readThemeSettings({ theme: { accent: "cornflower" } }).accent).toBe(
      "cornflower",
    );
  });

  test("reads a logo's path and alt text", () => {
    expect(
      readThemeSettings({
        theme: {
          logo: {
            path: "/public/val/brand/mark_a1b2c.png",
            width: 512,
            height: 512,
            mimeType: "image/png",
            alt: "The Acme mark",
          },
        },
      }).logo,
    ).toEqual({
      path: "/public/val/brand/mark_a1b2c.png",
      alt: "The Acme mark",
    });
  });

  test("a logo with no alt text is still a logo", () => {
    // `alt` is authored and usually is not. The mark still has to be drawn, and
    // the rail falls back to naming it after the project.
    expect(
      readThemeSettings({
        theme: { logo: { path: "/public/val/brand/mark_a1b2c.png" } },
      }).logo,
    ).toEqual({ path: "/public/val/brand/mark_a1b2c.png", alt: null });
  });

  test("a logo with no path is not a logo", () => {
    // `path` is the whole of what is needed to draw it, and the one field a
    // media value cannot be missing. Passing it through would render
    // `<img src="undefined">`, which is a broken-image icon where the mark
    // should be.
    const bads: Json[] = [
      {},
      { path: "" },
      { path: "   " },
      { path: 3 },
      "x",
      1,
    ];
    for (const bad of bads) {
      expect(readThemeSettings({ theme: { logo: bad } }).logo).toBeNull();
    }
  });
});
