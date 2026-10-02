import {
  initVal,
  Internal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import {
  computeChangedSourcePaths,
  type ChangeTreeNode,
} from "../utils/computeChangedSourcePaths";
import { PatchSets } from "../utils/PatchSets";
import {
  locateSourcePath,
  navNodeId,
  toCompareStructure,
} from "./toCompareStructure";

/**
 * A changed node, with as little around it as the adapter will accept.
 *
 * `computeChangedSourcePaths` produces these, and building one by hand here is
 * deliberate: what this file is about is the SHAPE the dialog is given, and
 * driving it through the whole patch-set pipeline would test that pipeline
 * instead — and hide, behind a passing test, which of the two decided the
 * answer.
 */
function changed(
  sourcePath: string,
  children: ChangeTreeNode[] = [],
): ChangeTreeNode {
  return {
    sourcePath: sourcePath as SourcePath,
    lastUpdated: "2026-09-01T00:00:00.000Z",
    isCommitted: false,
    change: {
      changeType: "field-change",
      patchIds: [],
      authors: [],
      lastUpdatedBy: null,
      patchesByAuthorIds: {},
    },
    children,
  };
}

/** A node that only holds others — a module root nothing happened AT. */
function branch(
  sourcePath: string,
  children: ChangeTreeNode[],
): ChangeTreeNode {
  return {
    sourcePath: sourcePath as SourcePath,
    lastUpdated: "2026-09-01T00:00:00.000Z",
    isCommitted: false,
    children,
  };
}

const ROUTER = "/app/blogs/[blog]/page.val.ts";
const DATA = "/content/authors.val.ts";

/** Only the router module is a page router, which is the split under test. */
const isPageModule = (moduleFilePath: ModuleFilePath): boolean =>
  moduleFilePath === ROUTER;

describe("toCompareStructure", () => {
  /**
   * A router module is many pages, and each is its own pane.
   *
   * The failure this replaces is three nav rows all called `page`: the module
   * is the file, and the file is not what changed.
   */
  test("gives a router module one pane per route", () => {
    const res = toCompareStructure({
      trees: [
        branch(ROUTER, [
          changed(`${ROUTER}?p="/blogs/one".title`),
          changed(`${ROUTER}?p="/blogs/two".title`),
        ]),
      ],
      isPageModule,
    });

    const nodes = res.sections.flatMap((section) => section.nodes);
    expect(nodes.map((node) => node.label).sort()).toEqual([
      "/blogs/one",
      "/blogs/two",
    ]);
    expect(res.changeCount).toBe(2);
    // And every nav node the dialog lists can actually be opened.
    for (const node of nodes) {
      expect(res.panes[node.id]).toBeDefined();
    }
  });

  /** A data module is one pane, named by itself rather than by its routes. */
  test("gives a data module a single pane", () => {
    const res = toCompareStructure({
      trees: [branch(DATA, [changed(`${DATA}?p="kimmid".name`)])],
      isPageModule,
    });

    const panes = Object.values(res.panes);
    expect(panes).toHaveLength(1);
    expect(panes[0].rows).toHaveLength(1);
    expect(res.changeCount).toBe(1);
  });

  /**
   * The count and the panes are read off the same thing.
   *
   * A change AT a router's record — a page added or removed — has no route of
   * its own, so `byRoute` drops it rather than opening a nav row called
   * `page`. Counting before that drop made the header promise a change the
   * dialog had nowhere to show, and in the worst case opened an empty dialog
   * under the words "1 change". Whatever the right answer to WHERE a root
   * change belongs turns out to be, the count may not disagree with the nav.
   */
  test("does not count a router root change it cannot show", () => {
    const res = toCompareStructure({
      trees: [changed(ROUTER)],
      isPageModule,
    });

    expect(res.sections.flatMap((section) => section.nodes)).toEqual([]);
    expect(res.panes).toEqual({});
    expect(res.changeCount).toBe(0);
  });

  test("counts the pages of a router whose record also changed", () => {
    const res = toCompareStructure({
      trees: [
        {
          ...changed(ROUTER),
          children: [changed(`${ROUTER}?p="/blogs/one".title`)],
        },
      ],
      isPageModule,
    });

    const nodes = res.sections.flatMap((section) => section.nodes);
    expect(nodes.map((node) => node.label)).toEqual(["/blogs/one"]);
    // One, not two: the root row is not shown, so it is not counted either.
    expect(res.changeCount).toBe(1);
  });

  /**
   * No module file path reaches a label, anywhere.
   *
   * The rule the whole module exists for, asserted over everything it emits
   * rather than on the one surface that broke last — a pane heading, a nav
   * label and a location are three different lines and all three had it.
   */
  test("never shows a module file path", () => {
    const res = toCompareStructure({
      trees: [
        branch(ROUTER, [changed(`${ROUTER}?p="/blogs/one".title`)]),
        branch(DATA, [changed(`${DATA}?p="kimmid".name`)]),
      ],
      isPageModule,
    });

    const shown = [
      ...res.sections.flatMap((section) => section.nodes.map((n) => n.label)),
      ...Object.values(res.panes).map((pane) => pane.location),
    ];
    for (const line of shown) {
      expect(line).not.toContain(".val.ts");
    }
  });
});

describe("locateSourcePath", () => {
  const structure = toCompareStructure({
    trees: [
      branch(ROUTER, [
        changed(`${ROUTER}?p="/blogs/one".title`),
        changed(`${ROUTER}?p="/blogs/two"`, [
          changed(`${ROUTER}?p="/blogs/two".title`),
        ]),
      ]),
      branch(DATA, [
        changed(`${DATA}?p="kim".name`),
        changed(`${DATA}?p="kim".bio`),
      ]),
    ],
    isPageModule,
  });

  test("lands on the row at the path", () => {
    expect(
      locateSourcePath(structure, `${DATA}?p="kim".bio` as SourcePath),
    ).toEqual({
      paneId: navNodeId(DATA),
      rowId: `${DATA}?p="kim".bio`,
    });
  });

  /* The gallery links the ENTRY; the change was to a field of it. */
  test("lands on the first row inside the path", () => {
    expect(
      locateSourcePath(structure, `${DATA}?p="kim"` as SourcePath),
    ).toEqual({
      paneId: navNodeId(DATA),
      rowId: `${DATA}?p="kim".name`,
    });
  });

  /* The link names a field; the change was the whole entry. */
  test("lands on the deepest row around the path", () => {
    expect(
      locateSourcePath(
        structure,
        `${ROUTER}?p="/blogs/two".title.sub` as SourcePath,
      ),
    ).toEqual({
      paneId: navNodeId(`${ROUTER}?p="/blogs/two"`),
      rowId: `${ROUTER}?p="/blogs/two".title`,
    });
  });

  test("files a page's path under the page, not the router module", () => {
    expect(
      locateSourcePath(structure, `${ROUTER}?p="/blogs/one"` as SourcePath)
        ?.paneId,
    ).toBe(navNodeId(`${ROUTER}?p="/blogs/one"`));
  });

  test("falls back to the pane when nothing at the path changed", () => {
    expect(
      locateSourcePath(structure, `${DATA}?p="ola"` as SourcePath),
    ).toEqual({ paneId: navNodeId(DATA), rowId: null });
  });

  test("is null for a path that is not in the publish", () => {
    expect(
      locateSourcePath(structure, "/content/other.val.ts" as SourcePath),
    ).toBeNull();
  });

  /*
   * Through the real pipeline, because the two halves spell the path
   * separately: the gallery builds its link with `createValPathOfItem`, and the
   * rows come out of `computeChangedSourcePaths`. If those ever disagree about
   * quoting, the link silently opens on the first change instead.
   */
  test("finds a gallery entry from the path the gallery links with", () => {
    const { s } = initVal();
    const GALLERY = "/content/media.val.ts" as ModuleFilePath;
    const REF = "/public/val/a_12345.png";
    const patchSets = new PatchSets();
    patchSets.insert(
      GALLERY,
      s
        .imageset({ accept: "image/*", dir: "/public/val" })
        ["executeSerialize"](),
      [{ op: "replace", path: [REF, "alt"], value: "A cat" }],
      "p1" as PatchId,
      "2026-10-01T10:00:00Z",
      "alice",
    );
    const linked = Internal.createValPathOfItem(GALLERY, REF);
    if (linked === undefined) throw Error("no path");
    const located = locateSourcePath(
      toCompareStructure({
        trees: computeChangedSourcePaths(patchSets.serialize(), new Set())
          .trees,
        isPageModule: () => false,
      }),
      linked,
    );
    expect(located?.paneId).toBe(navNodeId(GALLERY));
    expect(located?.rowId).not.toBeNull();
  });
});
