import { wireUp, type WireOptions } from "./wire";

/**
 * `wireUp` declares `@valbuild/ui` for a project that does not, because the
 * dependency layer is built from what a project declares and the Studio's
 * bundle is in ui. Which version it declares is the subject here: it used to
 * be `@valbuild/core`'s, and core and ui stopped being released together, so a
 * site declared an older Studio than the one its `@valbuild/tanstack` runs --
 * and its `package.json` matched neither its template's nor its lockfile.
 */

const options: WireOptions = {
  project: "a-site",
  loader: "https://platform.example",
};

function project(dependencies: Record<string, string>) {
  return {
    "val.config.ts": "export const config = {};\n",
    "val.modules.ts": "export default [];\n",
    "package.json": `${JSON.stringify({ name: "a-site", dependencies }, null, 2)}\n`,
  };
}

function declared(files: Record<string, string>) {
  const manifest: { dependencies?: Record<string, string> } = JSON.parse(
    files["package.json"] ?? "{}",
  );
  return manifest.dependencies ?? {};
}

describe("@valbuild/ui as wireUp declares it", () => {
  test("is the version the checkout has installed", () => {
    const wired = wireUp(
      project({ "@valbuild/core": "0.148.7", "@valbuild/tanstack": "0.149.1" }),
      { ...options, studioVersion: "0.149.1" },
    );
    expect(declared(wired.files)["@valbuild/ui"]).toBe("0.149.1");
    expect(wired.warnings.filter((w) => w.includes("@valbuild/ui"))).toEqual(
      [],
    );
  });

  test("falls back to @valbuild/core's version, and says so", () => {
    const wired = wireUp(
      project({ "@valbuild/core": "0.148.7", "@valbuild/tanstack": "0.149.1" }),
      options,
    );
    expect(declared(wired.files)["@valbuild/ui"]).toBe("0.148.7");
    expect(
      wired.warnings.some((w) => w.includes("@valbuild/core's version")),
    ).toBe(true);
  });

  test("leaves a project that declares it alone, package.json and all", () => {
    const files = project({
      "@valbuild/core": "0.148.7",
      "@valbuild/tanstack": "0.149.1",
      "@valbuild/ui": "0.149.1",
    });
    const wired = wireUp(files, { ...options, studioVersion: "0.150.0" });
    expect(wired.files["package.json"]).toBe(files["package.json"]);
    expect(wired.changes.map((c) => c.what)).not.toContain(
      "@valbuild/ui declared as a dependency",
    );
  });

  test("is not added to a project that does not declare Val", () => {
    const files = project({ react: "^19.2.0" });
    const wired = wireUp(files, { ...options, studioVersion: "0.149.1" });
    expect(wired.files["package.json"]).toBe(files["package.json"]);
  });
});
