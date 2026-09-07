import {
  KEEP_REASONS,
  parseArgs,
  planPrune,
  versionOf,
  type Options,
  type Release,
} from "./pruneGithubReleases";

function release(tag: string, over: Partial<Release> = {}): Release {
  return {
    id: Math.abs(hash(tag)),
    tag_name: tag,
    // What changesets/action wrote for every release before 0.117.0: not "",
    // which is why the check has to trim.
    body: "\n",
    draft: false,
    created_at: "2024-01-01T00:00:00Z",
    html_url: `https://github.com/valbuild/val/releases/tag/${tag}`,
    assets: [],
    ...over,
  };
}

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

const options = (over: Partial<Options> = {}): Options => ({
  ...parseArgs([]),
  ...over,
});

describe("versionOf", () => {
  it("reads the version off a scoped tag", () => {
    expect(versionOf("@valbuild/next@0.107.0")).toBe("0.107.0");
    expect(versionOf("@valcms/lib@0.0.2")).toBe("0.0.2");
  });

  it("reads the version off an unscoped tag", () => {
    expect(versionOf("val@1.2.3")).toBe("1.2.3");
  });

  it("is null when the tag carries no version", () => {
    expect(versionOf("v1.2.3")).toBeNull();
    expect(versionOf("main")).toBeNull();
  });

  /**
   * A scoped tag with no version is null, not the package name.
   *
   * The scope's own `@` sits at index 0, which is why the guard is `at > 0` and
   * not `at !== -1`. With the looser check this would read "next" as a version,
   * and a release tagged that way could then match the first-release rule and
   * be kept for a reason nobody could see.
   */
  it("is null for a scoped tag with no version", () => {
    expect(versionOf("@valbuild/next")).toBeNull();
  });
});

describe("planPrune", () => {
  it("deletes a release whose body is only whitespace", () => {
    const releases = [
      release("@valbuild/next@0.50.0", { body: "\n" }),
      release("@valbuild/core@0.50.0", { body: "" }),
      release("@valbuild/cli@0.50.0", { body: null }),
      release("@valbuild/ui@0.50.0", { body: "   \n  " }),
    ];
    const plan = planPrune(releases, options({ keepFirst: false }));
    expect(plan.delete).toHaveLength(4);
    expect(plan.keep).toHaveLength(0);
  });

  it("keeps a release that has notes", () => {
    const releases = [
      release("@valbuild/next@0.117.0", {
        body: "### Minor Changes\n\n- Every release now ships a changelog.",
      }),
      release("@valbuild/next@0.50.0"),
    ];
    const plan = planPrune(releases, options({ keepFirst: false }));
    expect(plan.keep.map((k) => k.release.tag_name)).toEqual([
      "@valbuild/next@0.117.0",
    ]);
    expect(plan.keep[0].reason).toBe(KEEP_REASONS.body);
    expect(plan.delete.map((r) => r.tag_name)).toEqual([
      "@valbuild/next@0.50.0",
    ]);
  });

  it("keeps an empty release that has an asset, because the bytes are only there", () => {
    const releases = [
      release("@valbuild/next@0.50.0", {
        assets: [{ id: 1, name: "val-vscode.vsix" }],
      }),
    ];
    const plan = planPrune(releases, options({ keepFirst: false }));
    expect(plan.delete).toHaveLength(0);
    expect(plan.keep[0].reason).toBe(KEEP_REASONS.assets);
  });

  it("keeps drafts and immutable releases", () => {
    const plan = planPrune(
      [
        release("@valbuild/next@0.50.0", { draft: true }),
        release("@valbuild/core@0.50.0", { immutable: true }),
      ],
      options({ keepFirst: false }),
    );
    expect(plan.delete).toHaveLength(0);
    expect(plan.keep.map((k) => k.reason)).toEqual([
      KEEP_REASONS.draft,
      KEEP_REASONS.immutable,
    ]);
  });

  /**
   * The rule that is easy to get wrong: the first release is a version, not a
   * row. Keeping only the single oldest row leaves its siblings deleted, and
   * the page then starts at one arbitrary package's 0.0.2.
   */
  it("keeps every sibling of the oldest release, not just the oldest row", () => {
    const releases = [
      release("@valcms/lib@0.0.2", { created_at: "2023-01-11T17:00:50Z" }),
      release("@valcms/react@0.0.2", { created_at: "2023-01-11T17:00:51Z" }),
      release("@valcms/server@0.0.2", { created_at: "2023-01-11T17:00:52Z" }),
      release("@valcms/lib@0.1.0", { created_at: "2023-01-13T09:15:48Z" }),
    ];
    const plan = planPrune(releases, options());
    expect(plan.keep.map((k) => k.release.tag_name).sort()).toEqual([
      "@valcms/lib@0.0.2",
      "@valcms/react@0.0.2",
      "@valcms/server@0.0.2",
    ]);
    expect(plan.keep.every((k) => k.reason === KEEP_REASONS.first)).toBe(true);
    expect(plan.delete.map((r) => r.tag_name)).toEqual(["@valcms/lib@0.1.0"]);
  });

  it("drops the first-release rule under --no-keep-first", () => {
    const releases = [
      release("@valcms/lib@0.0.2", { created_at: "2023-01-11T17:00:50Z" }),
    ];
    expect(planPrune(releases, parseArgs(["--no-keep-first"])).delete).toEqual(
      releases,
    );
  });

  it("keeps a tag named by --keep", () => {
    const releases = [
      release("@valbuild/next@0.50.0"),
      release("@valbuild/next@0.51.0"),
    ];
    const plan = planPrune(
      releases,
      parseArgs(["--no-keep-first", "--keep", "@valbuild/next@0.51.0"]),
    );
    expect(plan.keep.map((k) => k.release.tag_name)).toEqual([
      "@valbuild/next@0.51.0",
    ]);
    expect(plan.keep[0].reason).toBe(KEEP_REASONS.explicit);
  });

  /**
   * Oldest first so an interrupted run has removed a contiguous stretch of the
   * oldest, most-useless entries rather than a scattering.
   */
  it("orders the deletions oldest first", () => {
    const releases = [
      release("@valbuild/next@0.60.0", { created_at: "2024-06-01T00:00:00Z" }),
      release("@valbuild/next@0.40.0", { created_at: "2024-02-01T00:00:00Z" }),
      release("@valbuild/next@0.50.0", { created_at: "2024-04-01T00:00:00Z" }),
    ];
    expect(
      planPrune(releases, options({ keepFirst: false })).delete.map(
        (r) => r.tag_name,
      ),
    ).toEqual([
      "@valbuild/next@0.40.0",
      "@valbuild/next@0.50.0",
      "@valbuild/next@0.60.0",
    ]);
  });
});

describe("parseArgs", () => {
  it("defaults to a dry run that keeps the first releases", () => {
    const opts = parseArgs([]);
    expect(opts.apply).toBe(false);
    expect(opts.keepFirst).toBe(true);
    expect(opts.keepTags.size).toBe(0);
  });

  it("collects repeated --keep flags", () => {
    const opts = parseArgs(["--keep", "a@1.0.0", "--keep", "b@1.0.0"]);
    expect([...opts.keepTags]).toEqual(["a@1.0.0", "b@1.0.0"]);
  });

  it("rejects a --delay that is not a non-negative number", () => {
    expect(() => parseArgs(["--delay", "soon"])).toThrow(
      "--delay must be a non-negative number of ms",
    );
    expect(() => parseArgs(["--delay", "-1"])).toThrow(
      "--delay must be a non-negative number of ms",
    );
    expect(parseArgs(["--delay", "0"]).delayMs).toBe(0);
  });

  it("rejects a flag it does not know rather than ignoring it", () => {
    expect(() => parseArgs(["--force"])).toThrow("Unknown argument: --force");
    // A misspelled flag must not silently become a dry run's no-op.
    expect(() => parseArgs(["--aply"])).toThrow("Unknown argument: --aply");
  });

  it("rejects a value-taking flag with no value", () => {
    expect(() => parseArgs(["--keep"])).toThrow("--keep needs a value");
  });
});
