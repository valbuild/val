import { parseFeatureFlags, reconcile } from "./featureFlags";

/**
 * Answering the feature questions from the command line.
 *
 * The property worth pinning is that a recognised flag is CONSUMED: whatever is
 * left over is what the project name is read from, so a flag left in `rest`
 * becomes a project called `--no-mcp`.
 */

describe("parseFeatureFlags", () => {
  it("asks about everything when nothing was given", () => {
    expect(parseFeatureFlags(["my-app"])).toEqual({
      answers: {},
      rest: ["my-app"],
      contradiction: null,
    });
  });

  it.each([
    ["--mcp", { mcp: true }],
    ["--no-mcp", { mcp: false }],
    ["--image-uploads", { imageUploads: true }],
    ["--no-image-uploads", { imageUploads: false }],
  ])("reads %s", (flag, expected) => {
    const parsed = parseFeatureFlags([flag]);

    expect(parsed.answers).toEqual(expected);
    expect(parsed.rest).toEqual([]);
  });

  it("leaves the project name and other flags alone", () => {
    const parsed = parseFeatureFlags([
      "my-app",
      "--no-mcp",
      "--use-pnpm",
      "--image-uploads",
    ]);

    expect(parsed.answers).toEqual({ mcp: false, imageUploads: true });
    expect(parsed.rest).toEqual(["my-app", "--use-pnpm"]);
  });

  it("reports a flag given both ways rather than picking one", () => {
    const parsed = parseFeatureFlags(["--mcp", "--no-mcp"]);

    expect(parsed.contradiction).toBe("--mcp and --no-mcp");
    // And decides nothing about it: silently choosing would produce the wrong
    // project in a scripted setup, which is the only place this can happen.
    expect(parsed.answers.mcp).toBeUndefined();
  });
});

describe("reconcile", () => {
  it("leaves a coherent pair alone", () => {
    expect(reconcile({ mcp: true, imageUploads: true })).toEqual({
      features: { mcp: true, imageUploads: true },
      warning: null,
    });
    expect(reconcile({ mcp: true, imageUploads: false }).warning).toBeNull();
    expect(reconcile({ mcp: false, imageUploads: false }).warning).toBeNull();
  });

  it("turns image uploads off with the endpoint they need, and says so", () => {
    const { features, warning } = reconcile({
      mcp: false,
      imageUploads: true,
    });

    expect(features).toEqual({ mcp: false, imageUploads: false });
    expect(warning).toMatch(/--no-mcp/);
  });
});
