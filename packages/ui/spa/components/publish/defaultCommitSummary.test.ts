import {
  buildDefaultCommitSummary,
  moduleDisplayName,
  shouldAutoApplyAiSummary,
} from "./defaultCommitSummary";

describe("moduleDisplayName", () => {
  test("names a router file for its route, not for the file", () => {
    expect(moduleDisplayName("/content/blogs/page.val.ts")).toBe("Blogs");
    expect(moduleDisplayName("/content/index.val.ts")).toBe("Content");
  });

  test("uses the file name when it is not a router", () => {
    expect(moduleDisplayName("/content/home.val.ts")).toBe("Home");
    expect(moduleDisplayName("/content/site-settings.val.ts")).toBe(
      "Site settings",
    );
  });

  test("falls back to the path when there is no name to show", () => {
    expect(moduleDisplayName("/")).toBe("/");
  });
});

describe("buildDefaultCommitSummary", () => {
  test("is never empty, so publishing always has something to commit", () => {
    expect(buildDefaultCommitSummary([])).toBe("Update content");
  });

  test("names the one thing that changed", () => {
    expect(buildDefaultCommitSummary(["/content/home.val.ts"])).toBe(
      "Update Home",
    );
  });

  test("names a couple of things rather than counting them", () => {
    expect(
      buildDefaultCommitSummary([
        "/content/home.val.ts",
        "/content/about.val.ts",
      ]),
    ).toBe("Update About and Home");
  });

  test("names up to three, with no Oxford comma", () => {
    expect(
      buildDefaultCommitSummary([
        "/content/home.val.ts",
        "/content/about.val.ts",
        "/content/blogs/page.val.ts",
      ]),
    ).toBe("Update About, Blogs and Home");
  });

  test("switches to a count once naming them stops reading as a title", () => {
    expect(
      buildDefaultCommitSummary([
        "/content/home.val.ts",
        "/content/about.val.ts",
        "/content/blogs/page.val.ts",
        "/content/contact.val.ts",
      ]),
    ).toBe(
      "Update content in 4 places\n\nChanged: About, Blogs, Contact, Home",
    );
  });

  test("collapses duplicates from several patches to one module", () => {
    expect(
      buildDefaultCommitSummary([
        "/content/home.val.ts",
        "/content/home.val.ts",
      ]),
    ).toBe("Update Home");
  });

  test("truncates a long list rather than listing everything", () => {
    const paths = Array.from(
      { length: 9 },
      (_, i) => `/content/page-${i}.val.ts`,
    );
    const summary = buildDefaultCommitSummary(paths);
    expect(summary).toContain("Update content in 9 places");
    expect(summary).toContain("and 3 more");
  });
});

describe("shouldAutoApplyAiSummary", () => {
  const defaultSummary = "Update Home";

  test("takes over a box the user has not touched", () => {
    expect(
      shouldAutoApplyAiSummary({
        hasEdited: false,
        currentValue: defaultSummary,
        defaultSummary,
      }),
    ).toBe(true);
  });

  test("leaves the box alone once the user has started writing", () => {
    expect(
      shouldAutoApplyAiSummary({
        hasEdited: true,
        currentValue: "Fix typo in hero",
        defaultSummary,
      }),
    ).toBe(false);
  });

  test("stays cancelled after the user deletes back to the default", () => {
    // hasEdited latches, so retyping the default does not re-arm the takeover
    expect(
      shouldAutoApplyAiSummary({
        hasEdited: true,
        currentValue: defaultSummary,
        defaultSummary,
      }),
    ).toBe(false);
  });

  test("stays cancelled when the box is empty because they cleared it", () => {
    expect(
      shouldAutoApplyAiSummary({
        hasEdited: true,
        currentValue: "",
        defaultSummary,
      }),
    ).toBe(false);
  });

  test("does not take over a box that differs from the default anyway", () => {
    expect(
      shouldAutoApplyAiSummary({
        hasEdited: false,
        currentValue: "Something a previous session left here",
        defaultSummary,
      }),
    ).toBe(false);
  });

  test("ignores whitespace the textarea may have left behind", () => {
    expect(
      shouldAutoApplyAiSummary({
        hasEdited: false,
        currentValue: `  ${defaultSummary}\n`,
        defaultSummary,
      }),
    ).toBe(true);
  });
});
