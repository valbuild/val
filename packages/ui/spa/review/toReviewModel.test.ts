import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { PatchSetMetadata } from "../utils/PatchSets";
import type { Description } from "../utils/describePath";
import { reviewRowId, reviewSourcePath, toReviewModel } from "./toReviewModel";
import type { ReviewModelInput } from "./toReviewModel";

/**
 * The half of the review page that can be wrong without the types noticing.
 *
 * Everything here is a decision rather than a translation: which module a row
 * lands under, what a patch set is CALLED in one line, whose work a stage
 * would drag in, and which of those a reader is warned about. The layout is
 * looked at in Storybook; this is the part that has to be argued with.
 */
function patchSet(
  moduleFilePath: string,
  patchPath: string[],
  patches: Array<{
    patchId: string;
    author: string | null;
    opType: PatchSetMetadata["opTypes"][number];
  }>,
  schemaTypes: PatchSetMetadata["schemaTypes"] = ["string"],
): PatchSetMetadata {
  return {
    moduleFilePath: moduleFilePath as ModuleFilePath,
    patchPath,
    patches: patches.map((patch) => ({
      patchId: patch.patchId as PatchId,
      patchPath,
      opType: patch.opType,
      schemaTypes,
      author: patch.author,
      createdAt: "2026-09-20T11:00:00.000Z",
    })),
    authors: patches
      .map((patch) => patch.author)
      .filter((author): author is string => author !== null),
    opTypes: [...new Set(patches.map((patch) => patch.opType))],
    schemaTypes,
    lastUpdated: "2026-09-20T11:00:00.000Z",
    lastUpdatedBy: patches[patches.length - 1]?.author ?? null,
  };
}

/** A name nobody wrote: the path's own last segment, as `describePath` falls back to. */
function fallback(path: string): Description {
  const label = path.split("?").pop() ?? path;
  return {
    title: label,
    subtitle: null,
    image: null,
    pathLabel: label,
    url: null,
    origin: { title: "fallback", subtitle: "fallback", image: "fallback" },
  };
}

function input(over: Partial<ReviewModelInput> = {}): ReviewModelInput {
  return {
    patchSets: [],
    profiles: {
      ada: { fullName: "Ada Lovelace", avatar: null },
      linus: { fullName: "Linus Pauling", avatar: null },
    },
    mode: "http",
    currentAuthorId: "ada",
    stagingEnabled: true,
    stateOf: () => "staged",
    stagePreview: () => [],
    authorOf: () => null,
    describe: fallback,
    now: new Date("2026-09-20T12:00:00.000Z"),
    ...over,
  };
}

describe("grouping", () => {
  test("two patch sets in one module are one group, in order", () => {
    const model = toReviewModel(
      input({
        patchSets: [
          patchSet(
            "/content/authors.val.ts",
            ["teddy"],
            [{ patchId: "p1", author: "ada", opType: "replace" }],
          ),
          patchSet(
            "/content/authors.val.ts",
            ["kimmid"],
            [{ patchId: "p2", author: "linus", opType: "add" }],
          ),
          patchSet(
            "/app/page.val.ts",
            ["heading"],
            [{ patchId: "p3", author: "ada", opType: "replace" }],
          ),
        ],
      }),
    );
    expect(model.modules.map((group) => group.moduleFilePath)).toEqual([
      "/content/authors.val.ts",
      "/app/page.val.ts",
    ]);
    expect(model.modules[0].rows.map((row) => row.trail)).toEqual([
      ["teddy"],
      ["kimmid"],
    ]);
  });

  /*
   * The folders, prettified — never the file path. An editor has no checkout,
   * so `/app/blogs/[blog]/page.val.ts` names a file they cannot open.
   */
  test("a group carries a prettified location, not its path", () => {
    const model = toReviewModel(
      input({
        patchSets: [
          patchSet(
            "/app/blogs/[blog]/page.val.ts",
            ["/blogs/a"],
            [{ patchId: "p1", author: "ada", opType: "replace" }],
          ),
        ],
      }),
    );
    expect(model.modules[0].location).toBe("App / Blogs / Blog");
  });
});

describe("the row's trail", () => {
  /*
   * A gallery's keys ARE file paths, and a route key is the page's identity.
   * The two must not be spelled the same way, and this is the one place that
   * decides which is which.
   */
  test("a media key is its file name, a route key stays whole", () => {
    const model = toReviewModel(
      input({
        patchSets: [
          patchSet(
            "/content/media.val.ts",
            ["/public/val/images/hero-a1b2c.jpg"],
            [{ patchId: "p1", author: "ada", opType: "file" }],
            ["image"],
          ),
          patchSet(
            "/app/blogs/[blog]/page.val.ts",
            ["/blogs/getting-started", "title"],
            [{ patchId: "p2", author: "ada", opType: "replace" }],
          ),
        ],
      }),
    );
    expect(model.modules[0].rows[0].trail).toEqual(["hero-a1b2c.jpg"]);
    expect(model.modules[1].rows[0].trail).toEqual([
      "/blogs/getting-started",
      "title",
    ]);
  });
});

describe("the one-line summary", () => {
  test.each([
    ["add" as const, ["string"] as const, "Added"],
    ["remove" as const, ["string"] as const, "Removed"],
    ["move" as const, ["string"] as const, "Moved"],
    ["replace" as const, ["string"] as const, "Changed"],
    ["file" as const, ["image"] as const, "Image added"],
    ["replace" as const, ["image"] as const, "Image replaced"],
  ])("%s on %s reads as %s", (opType, schemaTypes, expected) => {
    const model = toReviewModel(
      input({
        patchSets: [
          patchSet(
            "/m.val.ts",
            ["x"],
            [{ patchId: "p1", author: "ada", opType }],
            [...schemaTypes],
          ),
        ],
      }),
    );
    expect(model.modules[0].rows[0].summary).toBe(expected);
  });

  /* Several kinds of edit in one set is "Edited": naming one would pick a winner. */
  test("a mixed patch set says only that it was edited", () => {
    const model = toReviewModel(
      input({
        patchSets: [
          patchSet(
            "/m.val.ts",
            ["x"],
            [
              { patchId: "p1", author: "ada", opType: "add" },
              { patchId: "p2", author: "ada", opType: "replace" },
            ],
          ),
        ],
      }),
    );
    expect(model.modules[0].rows[0].summary).toBe("Edited");
  });
});

describe("what staging would drag in", () => {
  const unstagedSet = patchSet(
    "/m.val.ts",
    ["x"],
    [{ patchId: "p2", author: "ada", opType: "replace" }],
  );

  /*
   * The prefix invariant, on the row and before the click. Named rather than
   * counted, because "also publishes 2 changes" does not tell you whose.
   */
  test("names the other people it would publish", () => {
    const model = toReviewModel(
      input({
        patchSets: [unstagedSet],
        stateOf: () => "unstaged",
        stagePreview: () => ["p1" as PatchId],
        authorOf: () => "linus",
      }),
    );
    expect(model.modules[0].rows[0].alsoStages).toEqual(["Linus Pauling"]);
  });

  /*
   * Your OWN earlier work is not a warning. It is already yours to publish,
   * and listing it reads as a caution about nothing — which is how a warning
   * that matters gets skipped.
   */
  test("says nothing when the work it drags in is your own", () => {
    const model = toReviewModel(
      input({
        patchSets: [unstagedSet],
        stateOf: () => "unstaged",
        stagePreview: () => ["p1" as PatchId],
        authorOf: () => "ada",
      }),
    );
    expect(model.modules[0].rows[0].alsoStages).toBeUndefined();
  });

  /* A staged row cannot drag anything in: it is already in the publish. */
  test("is absent on a staged row", () => {
    const model = toReviewModel(
      input({
        patchSets: [unstagedSet],
        stateOf: () => "staged",
        stagePreview: () => ["p1" as PatchId],
        authorOf: () => "linus",
      }),
    );
    expect(model.modules[0].rows[0].alsoStages).toBeUndefined();
  });
});

describe("staging", () => {
  /*
   * Where the server cannot store groups, every row is staged — not "unknown".
   * A publish there ships the chain, so saying anything else would describe a
   * publish that does not exist.
   */
  test("every row is staged when the server has no groups", () => {
    const model = toReviewModel(
      input({
        patchSets: [
          patchSet(
            "/m.val.ts",
            ["x"],
            [{ patchId: "p1", author: null, opType: "replace" }],
          ),
        ],
        stagingEnabled: false,
        stateOf: () => "unstaged",
      }),
    );
    expect(model.stagingEnabled).toBe(false);
    expect(model.modules[0].rows[0].staging).toBe("staged");
  });
});

describe("the row id", () => {
  /*
   * The patch set's PATH, never a patch id in it. A set coalesces as more
   * edits land on the same path, so "the id of its first patch" names a
   * different set an edit later — and a tick would silently move to another
   * row between a selection and the action on it.
   */
  test("is the patch set's path, so it survives a re-group", () => {
    const before = patchSet(
      "/m.val.ts",
      ["x"],
      [{ patchId: "p1", author: "ada", opType: "replace" }],
    );
    const after = patchSet(
      "/m.val.ts",
      ["x"],
      [
        { patchId: "p0", author: "linus", opType: "add" },
        { patchId: "p1", author: "ada", opType: "replace" },
      ],
    );
    expect(reviewRowId(after)).toBe(reviewRowId(before));
  });

  test("tells two patch sets in one module apart", () => {
    expect(reviewRowId(patchSet("/m.val.ts", ["a"], []))).not.toBe(
      reviewRowId(patchSet("/m.val.ts", ["b"], [])),
    );
  });
});

describe("the source path a row is named by", () => {
  /*
   * This is the key descriptions are looked up by, and `useReviewModel` builds
   * the list to resolve from the same function. Two spellings would be a
   * lookup that misses every time — a page of fallback names, which looks
   * like content without previews rather than like a bug.
   */
  test("is the module itself at the root", () => {
    expect(reviewSourcePath(patchSet("/m.val.ts", [], []))).toBe("/m.val.ts");
  });

  test("joins the patch path below it", () => {
    expect(reviewSourcePath(patchSet("/m.val.ts", ["a", "b"], []))).toBe(
      '/m.val.ts?p="a"."b"',
    );
  });
});
