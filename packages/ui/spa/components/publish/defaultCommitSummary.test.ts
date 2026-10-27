import {
  buildDefaultCommitMessage,
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

  test("strips .val.json too, so JSON entry modules do not leak an extension", () => {
    expect(moduleDisplayName("/content/students.val.json")).toBe("Students");
    expect(moduleDisplayName("/content/students/page.val.json")).toBe(
      "Students",
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

describe("buildDefaultCommitMessage", () => {
  test("is never empty", () => {
    expect(buildDefaultCommitMessage([])).toBe("Update content");
  });

  test("puts the exact path in the title when one field changed", () => {
    expect(
      buildDefaultCommitMessage([
        {
          moduleFilePath: "/content/home.val.ts",
          patchPath: ["hero", "title"],
        },
      ]),
    ).toBe("Update hero.title in /content/home.val.ts");
  });

  test("the same field patched twice is still one field", () => {
    expect(
      buildDefaultCommitMessage([
        { moduleFilePath: "/content/home.val.ts", patchPath: ["title"] },
        { moduleFilePath: "/content/home.val.ts", patchPath: ["title"] },
      ]),
    ).toBe("Update title in /content/home.val.ts");
  });

  test("a field inside another changed field is not named separately", () => {
    expect(
      buildDefaultCommitMessage([
        { moduleFilePath: "/content/home.val.ts", patchPath: ["hero"] },
        {
          moduleFilePath: "/content/home.val.ts",
          patchPath: ["hero", "title"],
        },
      ]),
    ).toBe("Update hero in /content/home.val.ts");
  });

  test("several fields of one module are listed in the body", () => {
    expect(
      buildDefaultCommitMessage([
        { moduleFilePath: "/content/home.val.ts", patchPath: ["title"] },
        {
          moduleFilePath: "/content/home.val.ts",
          patchPath: ["hero", "image"],
        },
      ]),
    ).toBe("Update Home\n\nChanged in /content/home.val.ts: hero.image, title");
  });

  test("the module as a whole is named by its path", () => {
    expect(
      buildDefaultCommitMessage([
        { moduleFilePath: "/content/home.val.ts", patchPath: [] },
        { moduleFilePath: "/content/home.val.ts", patchPath: ["title"] },
      ]),
    ).toBe("Update Home\n\nChanged: /content/home.val.ts");
  });

  test("several modules keep the named title and list every path", () => {
    expect(
      buildDefaultCommitMessage([
        { moduleFilePath: "/content/home.val.ts", patchPath: ["title"] },
        {
          moduleFilePath: "/content/blogs/page.val.ts",
          patchPath: ["/blogs/a", "title"],
        },
        { moduleFilePath: "/content/about.val.ts", patchPath: [] },
      ]),
    ).toBe(
      [
        "Update About, Blogs and Home",
        "",
        "Changed:",
        "- /content/about.val.ts",
        "- /content/blogs/page.val.ts: /blogs/a.title",
        "- /content/home.val.ts: title",
      ].join("\n"),
    );
  });

  test("caps a long list of modules and of fields", () => {
    const message = buildDefaultCommitMessage([
      ...Array.from({ length: 8 }, (_, i) => ({
        moduleFilePath: `/content/page-${i}.val.ts`,
        patchPath: ["title"],
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        moduleFilePath: "/content/page-0.val.ts",
        patchPath: [`field${i}`],
      })),
    ]);
    expect(message.split("\n")[0]).toBe("Update content in 8 places");
    expect(message).toContain("- and 2 more");
    expect(message).toContain("field4 and 3 more");
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
