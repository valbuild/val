import { initVal, Internal, type ModuleFilePath } from "@valbuild/core";
import {
  locateInReview,
  nameReviewPanes,
  toReviewPageModel,
  type ReviewModuleInput,
} from "./toReviewPageModel";
import type { CompareNavNode } from "../compare/types";
import type { ReviewPageModel } from "./types";

const { s, c } = initVal();

const BLOGS = "/app/blogs/[blog]/page.val.ts" as ModuleFilePath;
const AUTHORS = "/content/authors.val.ts" as ModuleFilePath;

const blogsVal = c.define(
  BLOGS,
  s
    .record(s.object({ title: s.string(), body: s.string() }))
    .router(Internal.nextAppRouter),
  {
    "/blogs/hello": { title: "Hello", body: "The first post." },
    "/blogs/about-us": { title: "About us", body: "We are forty people." },
    "/blogs/old": { title: "Old news", body: "Nobody reads this." },
  },
);
const authorsVal = c.define(
  AUTHORS,
  s.record(s.object({ name: s.string(), bio: s.string() })),
  {
    ada: { name: "Ada Lovelace", bio: "Wrote the first program." },
  },
);

const blogs = Internal.getSource(blogsVal);
const authors = Internal.getSource(authorsVal);

function moduleOf(
  moduleFilePath: ModuleFilePath,
  before: unknown,
  after: unknown,
): ReviewModuleInput {
  const val = moduleFilePath === BLOGS ? blogsVal : authorsVal;
  return {
    moduleFilePath,
    schema: Internal.getSchema(val)?.["executeSerialize"](),
    before,
    after,
  };
}

function model(
  modules: ReviewModuleInput[],
  rest: Partial<Parameters<typeof toReviewPageModel>[0]> = {},
): ReviewPageModel {
  return toReviewPageModel({
    modules,
    left: { label: "Published" },
    right: { label: "After publish" },
    profiles: {},
    ...rest,
  });
}

/**
 * The nav as lines: `section: label change (count)`, one per thing with a
 * pane. A data module sits under its folders, which are not listed.
 */
function nav(result: ReviewPageModel): string[] {
  const leaves = (nodes: CompareNavNode[]): CompareNavNode[] =>
    nodes.flatMap((node) =>
      node.children === undefined ? [node] : leaves(node.children),
    );
  return result.sections.flatMap((section) =>
    leaves(section.nodes).map(
      (node) =>
        `${section.title}: ${node.label} ${node.change ?? ""} (${
          node.changedCount ?? 0
        })${node.renamedFrom !== undefined ? ` was ${node.renamedFrom}` : ""}`,
    ),
  );
}

test("nothing changed is nothing to review", () => {
  const result = model([
    moduleOf(BLOGS, blogs, blogs),
    moduleOf(AUTHORS, authors, authors),
  ]);
  expect(result.sections).toEqual([]);
  expect(result.panes).toEqual({});
  expect(result.changeCount).toBe(0);
});

describe("a router module", () => {
  const after = {
    "/blogs/hello": { title: "Hello, spring", body: "The first post." },
    "/blogs/about": blogs["/blogs/about-us"],
    "/blogs/pricing": { title: "Pricing", body: "Free for one editor." },
  };
  const result = model([moduleOf(BLOGS, blogs, after)]);

  /** A file called `page` tells a reader nothing; a page is its address. */
  test("is listed by page, never by module", () => {
    expect(nav(result)).toEqual([
      "Pages: /blogs/hello changed (1)",
      "Pages: /blogs/about moved (0) was /blogs/about-us",
      "Pages: /blogs/pricing added (2)",
      "Pages: /blogs/old removed (2)",
    ]);
  });

  test("a changed page holds its changed fields, named from the page", () => {
    const pane = result.panes[`node:${BLOGS}?p="/blogs/hello"`];
    expect(pane).toMatchObject({
      title: "/blogs/hello",
      change: "changed",
      pageUrl: "/blogs/hello",
    });
    expect(pane.location).toBeUndefined();
    expect(pane.rows).toEqual([
      {
        id: `${BLOGS}?p="/blogs/hello"."title"`,
        label: "title",
        value: { kind: "text", before: "Hello", after: "Hello, spring" },
        authorIds: [],
      },
    ]);
  });

  test("a page at a new address is one page that moved", () => {
    expect(result.panes[`node:${BLOGS}?p="/blogs/about"`]).toMatchObject({
      change: "moved",
      renamedFrom: "/blogs/about-us",
      rows: [],
    });
  });

  test("counts the fields the panes hold", () => {
    expect(result.changeCount).toBe(5);
  });

  test("a page is called its preview, with its address under it", () => {
    const named = nameReviewPanes(result, (sourcePath) =>
      sourcePath === `${BLOGS}?p="/blogs/hello"` ? "Hello, spring" : null,
    );
    expect(named.panes[`node:${BLOGS}?p="/blogs/hello"`]).toMatchObject({
      title: "Hello, spring",
      location: "/blogs/hello",
    });
    // Unnamed, the others are still called their routes, once.
    expect(named.panes[`node:${BLOGS}?p="/blogs/pricing"`]).toMatchObject({
      title: "/blogs/pricing",
    });
    expect(
      named.panes[`node:${BLOGS}?p="/blogs/pricing"`].location,
    ).toBeUndefined();
  });

  describe("a link to a change", () => {
    test("lands on the row at the path", () => {
      expect(
        locateInReview(result, `${BLOGS}?p="/blogs/hello"."title"`),
      ).toEqual({
        paneId: `node:${BLOGS}?p="/blogs/hello"`,
        rowId: `${BLOGS}?p="/blogs/hello"."title"`,
      });
    });

    test("to a page lands on its first change", () => {
      expect(locateInReview(result, `${BLOGS}?p="/blogs/pricing"`)).toEqual({
        paneId: `node:${BLOGS}?p="/blogs/pricing"`,
        rowId: `${BLOGS}?p="/blogs/pricing"."title"`,
      });
    });

    test("to a field that did not change lands on its page", () => {
      expect(
        locateInReview(result, `${BLOGS}?p="/blogs/hello"."body"`),
      ).toEqual({ paneId: `node:${BLOGS}?p="/blogs/hello"`, rowId: null });
    });

    test("to something that did not change lands nowhere", () => {
      expect(locateInReview(result, `${AUTHORS}?p="ada"`)).toBeNull();
    });
  });
});

describe("any other module", () => {
  const after = {
    ada: { name: "Ada Lovelace", bio: "Wrote the first published program." },
  };

  test("is one pane, under Data", () => {
    const result = model([moduleOf(AUTHORS, authors, after)]);
    expect(nav(result)).toEqual(["Data: authors changed (1)"]);
    expect(result.panes[`node:${AUTHORS}`]).toMatchObject({
      title: "authors",
      change: "changed",
    });
    expect(result.panes[`node:${AUTHORS}`].pageUrl).toBeUndefined();
  });

  test("that is new on the right is added", () => {
    const result = model([moduleOf(AUTHORS, undefined, authors)]);
    expect(nav(result)).toEqual(["Data: authors added (1)"]);
  });
});

describe("who made a change", () => {
  const after = {
    ...blogs,
    "/blogs/hello": { title: "Hello, spring", body: "The very first post." },
  };

  test("is everyone with a pending edit at it", () => {
    const result = model([moduleOf(BLOGS, blogs, after)], {
      edits: [
        {
          sourcePath: `${BLOGS}?p="/blogs/hello"."title"`,
          authorIds: ["ada"],
        },
        {
          sourcePath: `${BLOGS}?p="/blogs/hello"."body"`,
          authorIds: ["linus", "ada"],
        },
      ],
    });
    const pane = result.panes[`node:${BLOGS}?p="/blogs/hello"`];
    expect(pane.rows.map((row) => [row.label, row.authorIds])).toEqual([
      ["title", ["ada"]],
      ["body", ["linus", "ada"]],
    ]);
    expect(result.sections[0].nodes[0].authorIds).toEqual(["ada", "linus"]);
  });

  /** A page added whole is one edit, and every field of it is that edit's. */
  test("is whoever made an edit around it", () => {
    const result = model(
      [
        moduleOf(BLOGS, blogs, {
          ...blogs,
          "/blogs/pricing": { title: "Pricing", body: "Free." },
        }),
      ],
      {
        edits: [
          { sourcePath: `${BLOGS}?p="/blogs/pricing"`, authorIds: ["ada"] },
        ],
      },
    );
    const pane = result.panes[`node:${BLOGS}?p="/blogs/pricing"`];
    expect(pane.rows.map((row) => row.authorIds)).toEqual([["ada"], ["ada"]]);
  });

  /** In a proposal, a change that was already saved is nobody's pending edit. */
  test("is nobody, for a change no pending edit explains", () => {
    const result = model([moduleOf(BLOGS, blogs, after)], {
      edits: [
        { sourcePath: `${BLOGS}?p="/blogs/hello-again"`, authorIds: ["ada"] },
      ],
    });
    const pane = result.panes[`node:${BLOGS}?p="/blogs/hello"`];
    expect(pane.rows.flatMap((row) => row.authorIds)).toEqual([]);
  });
});
