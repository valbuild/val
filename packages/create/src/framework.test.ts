import type { CatalogTemplate } from "./catalog";
import {
  DEFAULT_FRAMEWORK,
  dropUnsupportedFeatures,
  FRAMEWORK_NAMES,
  FRAMEWORKS,
  parseFrameworkArgs,
  parseTemplateArgs,
  resolveFrameworkName,
  resolveTemplateArg,
} from "./framework";

/**
 * Choosing a framework, from a flag or from the prompt's default.
 *
 * The parsing is what these are mostly about: a flag that is silently not
 * understood is how a scripted setup produces a Next project when it asked for
 * a TanStack one, and the project name is whatever survives the flags — so a
 * framework flag that fails to consume itself becomes the project's name.
 */

/** A catalog like `valbuild/templates`' own, as far as these care. */
function template(
  id: string,
  framework: CatalogTemplate["framework"],
  name: string,
  features: CatalogTemplate["features"] = {
    mcp: { paths: ["src/val/mcp.ts"], dependencies: [], docs: [] },
    imageUploads: { file: "src/val/mcp.images.ts", dependencies: ["sharp"] },
  },
): CatalogTemplate {
  return {
    id,
    framework,
    name,
    description: `${name} for ${framework}`,
    path: id.replace("-", "/"),
    features,
  };
}

const CATALOG: CatalogTemplate[] = [
  template("tanstack-full", "tanstack", "Full"),
  template("tanstack-minimal", "tanstack", "Minimal"),
  template("nextjs-full", "nextjs", "Full"),
  template("nextjs-minimal", "nextjs", "Minimal"),
];

describe("FRAMEWORKS", () => {
  it("covers both frameworks we ship", () => {
    // Copied before sorting: `sort` is in-place, and `FRAMEWORKS` is an
    // exported singleton the CLI reads for its help text and error messages.
    expect([...FRAMEWORKS].sort()).toEqual(["nextjs", "tanstack"]);
  });

  it("has a default that is one of them", () => {
    expect(FRAMEWORKS).toContain(DEFAULT_FRAMEWORK);
  });

  it("offers TanStack Start first, and by default", () => {
    // Val's primary platform.
    expect(FRAMEWORKS[0]).toBe("tanstack");
    expect(DEFAULT_FRAMEWORK).toBe("tanstack");
  });

  it("has a name for each", () => {
    for (const framework of FRAMEWORKS) {
      expect(FRAMEWORK_NAMES[framework]).toBeTruthy();
    }
  });
});

describe("resolveFrameworkName", () => {
  it("takes the canonical names", () => {
    expect(resolveFrameworkName("nextjs")).toBe("nextjs");
    expect(resolveFrameworkName("tanstack")).toBe("tanstack");
  });

  it("takes the aliases people actually type", () => {
    expect(resolveFrameworkName("next")).toBe("nextjs");
    expect(resolveFrameworkName("next.js")).toBe("nextjs");
    expect(resolveFrameworkName("tanstack-start")).toBe("tanstack");
  });

  it("ignores case and surrounding space", () => {
    expect(resolveFrameworkName("  NextJS ")).toBe("nextjs");
    expect(resolveFrameworkName("TanStack")).toBe("tanstack");
  });

  it("is null for anything else", () => {
    expect(resolveFrameworkName("svelte")).toBeNull();
    expect(resolveFrameworkName("")).toBeNull();
  });
});

describe("parseFrameworkArgs", () => {
  it("asks nothing when no flag was given", () => {
    const parsed = parseFrameworkArgs(["my-app"]);
    expect(parsed.framework).toBeNull();
    expect(parsed.invalidFlag).toBeNull();
    expect(parsed.rest).toEqual(["my-app"]);
  });

  it("reads --framework <name> and consumes the value", () => {
    const parsed = parseFrameworkArgs(["--framework", "tanstack", "my-app"]);
    expect(parsed.framework).toBe("tanstack");
    expect(parsed.rest).toEqual(["my-app"]);
  });

  it("reads --framework=<name>", () => {
    const parsed = parseFrameworkArgs(["--framework=tanstack", "my-app"]);
    expect(parsed.framework).toBe("tanstack");
    expect(parsed.rest).toEqual(["my-app"]);
  });

  it("reads the bare shorthands", () => {
    expect(parseFrameworkArgs(["--tanstack"]).framework).toBe("tanstack");
    expect(parseFrameworkArgs(["--nextjs"]).framework).toBe("nextjs");
    expect(parseFrameworkArgs(["--next"]).framework).toBe("nextjs");
  });

  it("consumes the shorthand, so it cannot become the project name", () => {
    const parsed = parseFrameworkArgs(["--tanstack", "my-app"]);
    expect(parsed.rest).toEqual(["my-app"]);
  });

  it("leaves other people's flags alone", () => {
    const parsed = parseFrameworkArgs(["--use-pnpm", "--no-mcp", "my-app"]);
    expect(parsed.framework).toBeNull();
    expect(parsed.rest).toEqual(["--use-pnpm", "--no-mcp", "my-app"]);
  });

  it("lets the last flag win", () => {
    expect(
      parseFrameworkArgs(["--framework", "nextjs", "--tanstack"]).framework,
    ).toBe("tanstack");
    expect(
      parseFrameworkArgs(["--tanstack", "--framework=nextjs"]).framework,
    ).toBe("nextjs");
  });

  it("reports a framework it does not have, with the value", () => {
    const parsed = parseFrameworkArgs(["--framework", "svelte"]);
    expect(parsed.framework).toBeNull();
    expect(parsed.invalidFlag).toBe("--framework svelte");
  });

  it("reports --framework with nothing after it", () => {
    const parsed = parseFrameworkArgs(["--framework"]);
    expect(parsed.invalidFlag).toBe("--framework");
  });

  it("keeps the first complaint when there are two", () => {
    const parsed = parseFrameworkArgs([
      "--framework=svelte",
      "--framework=solid",
    ]);
    expect(parsed.invalidFlag).toBe("--framework=svelte");
  });
});

describe("parseTemplateArgs", () => {
  it("asks nothing when no flag was given", () => {
    const parsed = parseTemplateArgs(["my-app"]);
    expect(parsed.template).toBeNull();
    expect(parsed.rest).toEqual(["my-app"]);
  });

  it("consumes its value, so it cannot become the project name", () => {
    const parsed = parseTemplateArgs(["--template", "full", "my-app"]);
    expect(parsed.template).toBe("full");
    expect(parsed.rest).toEqual(["my-app"]);
  });

  it("reads --template=<id>", () => {
    expect(parseTemplateArgs(["--template=tanstack-full"]).template).toBe(
      "tanstack-full",
    );
  });

  it("reports --template with nothing after it", () => {
    expect(parseTemplateArgs(["--template"]).invalidFlag).toBe("--template");
    expect(parseTemplateArgs(["--template="]).invalidFlag).toBe("--template=");
    // A flag is not a template name: the next flag is left for its parser.
    const parsed = parseTemplateArgs(["--template", "--use-pnpm"]);
    expect(parsed.invalidFlag).toBe("--template");
    expect(parsed.rest).toEqual(["--use-pnpm"]);
  });
});

describe("resolveTemplateArg", () => {
  it("takes an id, which names the framework too", () => {
    const resolved = resolveTemplateArg("nextjs-minimal", CATALOG, null);
    expect(resolved.status === "ok" && resolved.template.id).toBe(
      "nextjs-minimal",
    );
  });

  it("refuses an id for another framework than the one asked for", () => {
    const resolved = resolveTemplateArg("nextjs-full", CATALOG, "tanstack");
    expect(resolved.status).toBe("error");
  });

  it("takes a name within the framework, ignoring case", () => {
    const resolved = resolveTemplateArg("MINIMAL", CATALOG, "tanstack");
    expect(resolved.status === "ok" && resolved.template.id).toBe(
      "tanstack-minimal",
    );
  });

  it("waits for the framework when a name could be either", () => {
    expect(resolveTemplateArg("full", CATALOG, null)).toEqual({
      status: "needs-framework",
      name: "full",
    });
  });

  it("names what there is when it names nothing", () => {
    const resolved = resolveTemplateArg("blog", CATALOG, null);
    expect(resolved.status).toBe("error");
    expect(resolved.status === "error" && resolved.message).toContain(
      "tanstack-full",
    );
  });

  it("says so when the framework has no template of that name", () => {
    const resolved = resolveTemplateArg(
      "docs",
      [...CATALOG, template("nextjs-docs", "nextjs", "Docs")],
      "tanstack",
    );
    expect(resolved.status).toBe("error");
    expect(resolved.status === "error" && resolved.message).toContain(
      "TanStack Start",
    );
  });
});

describe("dropUnsupportedFeatures", () => {
  const withEverything = CATALOG[0];
  const withoutMcp = template("tanstack-bare", "tanstack", "Bare", {});
  const withoutImages = template("tanstack-noimg", "tanstack", "NoImg", {
    mcp: { paths: ["src/val/mcp.ts"], dependencies: [], docs: [] },
  });

  it("leaves a template that has everything alone", () => {
    const result = dropUnsupportedFeatures(
      { mcp: true, imageUploads: true },
      withEverything,
    );
    expect(result.features).toEqual({ mcp: true, imageUploads: true });
    expect(result.warning).toBeNull();
  });

  it("turns MCP off, and says so, where the template has no endpoint", () => {
    const result = dropUnsupportedFeatures(
      { mcp: true, imageUploads: true },
      withoutMcp,
    );
    expect(result.features).toEqual({ mcp: false, imageUploads: false });
    expect(result.warning).toContain("TanStack Start Bare");
  });

  it("says nothing when nothing was asked for", () => {
    const result = dropUnsupportedFeatures(
      { mcp: false, imageUploads: false },
      withoutMcp,
    );
    expect(result.features).toEqual({ mcp: false, imageUploads: false });
    expect(result.warning).toBeNull();
  });

  it("still reports image uploads asked for on their own", () => {
    const result = dropUnsupportedFeatures(
      { mcp: false, imageUploads: true },
      withoutMcp,
    );
    expect(result.features).toEqual({ mcp: false, imageUploads: false });
    expect(result.warning).not.toBeNull();
  });

  it("keeps MCP and drops only image uploads where those are missing", () => {
    const result = dropUnsupportedFeatures(
      { mcp: true, imageUploads: true },
      withoutImages,
    );
    expect(result.features).toEqual({ mcp: true, imageUploads: false });
    expect(result.warning).toContain("image uploads");
  });
});
