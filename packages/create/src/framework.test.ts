import {
  DEFAULT_FRAMEWORK,
  dropUnsupportedFeatures,
  FRAMEWORKS,
  parseFrameworkArgs,
  resolveFrameworkName,
  TEMPLATES,
} from "./framework";

/**
 * Choosing a framework, from a flag or from the prompt's default.
 *
 * The parsing is what these are mostly about: a flag that is silently not
 * understood is how a scripted setup produces a Next project when it asked for
 * a TanStack one, and the project name is whatever survives the flags — so a
 * framework flag that fails to consume itself becomes the project's name.
 */

describe("TEMPLATES", () => {
  it("has a template for every framework, keyed by its own name", () => {
    for (const framework of FRAMEWORKS) {
      expect(TEMPLATES[framework].framework).toBe(framework);
    }
  });

  it("covers both frameworks we ship", () => {
    expect(FRAMEWORKS.sort()).toEqual(["nextjs", "tanstack"]);
  });

  it("has a default that is one of them", () => {
    expect(FRAMEWORKS).toContain(DEFAULT_FRAMEWORK);
  });

  it("points each framework at its own repository", () => {
    expect(TEMPLATES.nextjs.repo).toBe("valbuild/template-nextjs-starter");
    expect(TEMPLATES.tanstack.repo).toBe("valbuild/template-tanstack-starter");
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

describe("dropUnsupportedFeatures", () => {
  it("leaves a template that supports MCP alone", () => {
    const result = dropUnsupportedFeatures(
      { mcp: true, imageUploads: true },
      TEMPLATES.nextjs,
    );
    expect(result.features).toEqual({ mcp: true, imageUploads: true });
    expect(result.warning).toBeNull();
  });

  it("turns MCP off, and says so, where the starter has no endpoint", () => {
    const result = dropUnsupportedFeatures(
      { mcp: true, imageUploads: true },
      TEMPLATES.tanstack,
    );
    expect(result.features).toEqual({ mcp: false, imageUploads: false });
    expect(result.warning).toContain("TanStack Start");
  });

  it("says nothing when nothing was asked for", () => {
    const result = dropUnsupportedFeatures(
      { mcp: false, imageUploads: false },
      TEMPLATES.tanstack,
    );
    expect(result.features).toEqual({ mcp: false, imageUploads: false });
    expect(result.warning).toBeNull();
  });

  it("still reports image uploads asked for on their own", () => {
    const result = dropUnsupportedFeatures(
      { mcp: false, imageUploads: true },
      TEMPLATES.tanstack,
    );
    expect(result.features).toEqual({ mcp: false, imageUploads: false });
    expect(result.warning).not.toBeNull();
  });
});
