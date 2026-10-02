import { Internal, type ModuleFilePath, type SourcePath } from "@valbuild/core";
import type {
  ChangeTreeNode,
  ChangeType,
} from "../utils/computeChangedSourcePaths";
import { pageRouteOf } from "../utils/pageRoutes";
import { prettyModuleLocation } from "../utils/prettyModulePath";
import { isPathWithin } from "../utils/sourcePath";
import { buildDataTree } from "./navTree";
import type {
  CompareAuthorship,
  CompareChangeKind,
  CompareFocus,
  CompareNavNode,
  CompareNavSection,
} from "./types";

/**
 * A publish, as the compare dialog's SHAPE — without a pixel of it.
 *
 * Split from `useCompareModel` for the reason `shellDataMapping` gives, plus
 * one specific to this view: `CompareModel` carries `before`/`after` as
 * `ReactNode`, so a function producing one could only be tested by rendering
 * it. What is worth testing here is not the pixels but the decisions — what
 * the nav lists, what a pane holds, what a thing is CALLED — and those are all
 * here, as paths.
 *
 * ## A page is the unit, not the module it lives in
 *
 * A router module is ONE module holding MANY pages, so listing changes by
 * module produced three rows called `page` — which is what the FILE is called
 * and tells a reader nothing. The thing that changed is the page, and a page
 * is named by its URL. So a page router's changes are grouped by route and
 * every other module's by module.
 *
 * Nothing here ever shows a module file path. `/app/blogs/[blog]/page.val.ts`
 * names a file an editor has no checkout of, in conventions they do not write;
 * a page is located by its URL, and a data module by its folders, spelled the
 * way the left nav spells them.
 *
 * And nothing is printed that the line above it already said. An unnamed page
 * is CALLED its route, so it has no second line — the route is the whole of
 * what there is to say about it, and a page that deserves a better heading is
 * a page whose schema should declare `.preview(...)`. A named one keeps the
 * route below, because there a name and an address are different answers.
 */
export type CompareStructure = {
  sections: CompareNavSection[];
  /** Keyed by nav node id, like `CompareModel.panes`. */
  panes: Record<string, ComparePaneStructure>;
  /** Total changed things, for the count under the dialog title. */
  changeCount: number;
};

export type ComparePaneStructure = {
  /**
   * The path this pane is OF — a page, or a module root.
   *
   * What the heading is named from, via `describePath`: for a page that is the
   * route (and its preview, where the schema writes one), for a module its own
   * name.
   */
  sourcePath: SourcePath;
  /**
   * WHERE it is, spelled for a reader and never a file path.
   *
   * A page's URL, or a data module's folders as the left nav spells them —
   * `Content / Authors`. Null when there is nothing worth saying.
   */
  location: string | null;
  change?: CompareChangeKind;
  rows: CompareRowStructure[];
};

export type CompareRowStructure = {
  id: string;
  /** The path whose value the two sides render. */
  sourcePath: SourcePath;
  /** Where the row sits inside its page or module. */
  label: string;
  change: CompareChangeKind;
  authors: CompareAuthorship;
  /** The patches behind it, which is what an undo would drop. */
  patchIds: string[];
};

export type CompareStructureInput = {
  trees: ChangeTreeNode[];
  /**
   * Whether this module's keys are URLs of the site.
   *
   * Passed in rather than read here, because the answer is in the SCHEMA and
   * this function is pure. `isPageModule` is the one implementation; the hook
   * supplies it.
   */
  isPageModule: (moduleFilePath: ModuleFilePath) => boolean;
};

/**
 * `ChangeType` is what the patch ops said happened; `CompareChangeKind` is
 * what a reader is shown. The only one that is not a rename is `field-change`,
 * which is "changed" — the word the view's badge and rails are written for.
 */
function toChangeKind(changeType: ChangeType): CompareChangeKind {
  return changeType === "field-change" ? "changed" : changeType;
}

export function toCompareStructure({
  trees,
  isPageModule,
}: CompareStructureInput): CompareStructure {
  const panes: Record<string, ComparePaneStructure> = {};
  const pageNodes: CompareNavNode[] = [];
  const dataModules: {
    moduleFilePath: string;
    rows: CompareRowStructure[];
  }[] = [];
  let changeCount = 0;

  for (const tree of trees) {
    const moduleFilePath = tree.sourcePath as ModuleFilePath;
    const isPage = isPageModule(moduleFilePath);
    const rows = rowsOf(tree);

    if (!isPage) {
      changeCount += rows.length;
      panes[navNodeId(moduleFilePath)] = {
        sourcePath: moduleFilePath as unknown as SourcePath,
        /*
         * The FOLDERS, not the folders plus the module's own name. The
         * heading already said the name, so `Content / Authors` under
         * `Authors` spends the line saying `Authors` twice. Same spelling the
         * left nav uses, and the same rule a page follows: nothing is printed
         * that the line above it already said.
         */
        location: prettyModuleLocation(moduleFilePath),
        ...(tree.change
          ? { change: toChangeKind(tree.change.changeType) }
          : {}),
        rows: rows.map((row) => ({
          ...row,
          label: trailOf(row.sourcePath, 0),
        })),
      };
      dataModules.push({ moduleFilePath, rows });
      continue;
    }

    /*
     * One pane and one nav row per PAGE. A change at the module root — the
     * record itself, which is a page being added or removed — has no route of
     * its own, so it is attributed to the page it names.
     */
    const pages = byRoute(rows);
    /*
     * Counted from what the panes will HOLD, not from what the tree offered.
     *
     * `byRoute` drops a change at the record itself — see the note in it —
     * and counting before the drop made the header promise changes that the
     * nav could not show: a module whose only change was at its root reported
     * "1 change" over an empty dialog, and every other router module
     * over-reported by however many root rows it had. The count and the panes
     * have to be read off the same thing or one of them is lying.
     */
    for (const pageRows of pages.values()) {
      changeCount += pageRows.length;
    }

    for (const [route, pageRows] of pages) {
      const pagePath = joinRoute(moduleFilePath, route);
      const id = navNodeId(pagePath);
      panes[id] = {
        sourcePath: pagePath,
        /* The URL is the page's location AND its identity. See `Description.url`. */
        location: route,
        ...changeOfRows(pageRows),
        /* One segment in: everything under the route key is inside the page. */
        rows: pageRows.map((row) => ({
          ...row,
          label: trailOf(row.sourcePath, 1),
        })),
      };
      pageNodes.push({
        id,
        label: route,
        kind: "page",
        ...changeOfRows(pageRows),
        changedCount: pageRows.length,
        ...authorIdsOf(pageRows),
      });
    }
  }

  const sections: CompareNavSection[] = [];
  if (pageNodes.length > 0) {
    sections.push({ id: "pages", title: "Pages", nodes: pageNodes });
  }
  if (dataModules.length > 0) {
    sections.push({
      id: "data",
      title: "Data",
      /*
       * Through `buildDataTree`, so the directory grouping, the sort and VS
       * Code's compact folders are the ones it is tested on. A tree built here
       * would be a second implementation that agrees with nothing.
       */
      nodes: buildDataTree(
        dataModules.map(({ moduleFilePath, rows }) => {
          return {
            moduleFilePath,
            node: {
              id: navNodeId(moduleFilePath),
              /*
               * The same mark pages get, from the same function. Without it
               * one half of the nav carried change icons and the other did
               * not, which reads as the two halves disagreeing about what a
               * row is rather than as a fact about the content.
               */
              ...changeOfRows(rows),
              changedCount: rows.length,
              ...authorIdsOf(rows),
            },
          };
        }),
      ),
    });
  }
  return { sections, panes, changeCount };
}

/** The nav id for a page or a module, and the key its pane is stored under. */
export function navNodeId(sourcePath: string): string {
  return `node:${sourcePath}`;
}

/**
 * The pane, and the row in it, that a source path names.
 *
 * For a link INTO the dialog — "show me the change to this" — from a surface
 * that knows a path and nothing about how the dialog groups changes. Which
 * pane a path lands in is this file's decision (a page router's changes are
 * filed by route, everything else by module), so the answer is read off the
 * panes it built rather than worked out a second time.
 *
 * The link names what its surface knows, which is not always the row:
 *
 * 1. a row AT the path wins — the change is exactly the thing linked to;
 * 2. else the first row INSIDE it — the media gallery links an entry, and the
 *    change was to its `alt`;
 * 3. else the deepest row AROUND it — the link names a field of an entry that
 *    was added whole;
 * 4. else the pane the path is inside, with no row — nothing at the path
 *    changed, but the page or module it is in did, and that is the nearest
 *    thing the dialog has to show.
 *
 * Null when nothing matches: the change is not in this publish.
 */
export function locateSourcePath(
  structure: Pick<CompareStructure, "panes">,
  sourcePath: SourcePath,
): CompareFocus | null {
  let inside: CompareFocus | null = null;
  let around: { focus: CompareFocus; depth: number } | null = null;
  let pane: CompareFocus | null = null;
  for (const [paneId, candidate] of Object.entries(structure.panes)) {
    for (const row of candidate.rows) {
      if (row.sourcePath === sourcePath) {
        return { paneId, rowId: row.id };
      }
      if (inside === null && isPathWithin(row.sourcePath, sourcePath)) {
        inside = { paneId, rowId: row.id };
      }
      if (
        isPathWithin(sourcePath, row.sourcePath) &&
        (around === null || row.sourcePath.length > around.depth)
      ) {
        around = {
          focus: { paneId, rowId: row.id },
          depth: row.sourcePath.length,
        };
      }
    }
    if (pane === null && isPathWithin(sourcePath, candidate.sourcePath)) {
      pane = { paneId, rowId: null };
    }
  }
  return inside ?? around?.focus ?? pane;
}

function joinRoute(moduleFilePath: ModuleFilePath, route: string): SourcePath {
  return Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    Internal.patchPathToModulePath([route]),
  );
}

/**
 * The rows of one router module, split by the page they are in.
 *
 * A `Map`, so the pages come out in the order their first change did — which
 * is the patch sets' own newest-first order, and therefore the order an editor
 * last touched them.
 */
function byRoute(
  rows: CompareRowStructure[],
): Map<string, CompareRowStructure[]> {
  const byPage = new Map<string, CompareRowStructure[]>();
  for (const row of rows) {
    const route = pageRouteOf(row.sourcePath);
    if (route === null) {
      /*
       * A change AT the record itself, which is a page being added or removed.
       * `computeChangedSourcePaths` puts that on the module node, so there is
       * no route to read — and no page to file it under either. It is dropped
       * rather than shown as a module row: a nav entry called `page` is the
       * thing this grouping exists to remove, and the page's own row carries
       * the add or the remove anyway.
       */
      continue;
    }
    const existing = byPage.get(route);
    if (existing === undefined) byPage.set(route, [row]);
    else existing.push(row);
  }
  return byPage;
}

/**
 * What happened to a thing as a whole — a page, or a module.
 *
 * ONE derivation for both sections, which is the point. A mark that appeared
 * on every page row and on no data row did not read as "this page was
 * edited"; it read as the two halves of the nav disagreeing about what a row
 * is. The icons are worth having — added, removed and renamed are what an
 * editor scans a publish for, and a rename is the line most likely to have
 * broken an inbound link — so the fix is to mark both, not to mark neither.
 *
 * An add, a remove or a rename of the thing ITSELF wins over an edit inside
 * it: "this page is gone" is the story, and the fields that went with it are
 * a detail of it.
 *
 * Read off the rows rather than from the node's own `change`, because a router
 * module's change is about the record and not about any one page in it.
 */
function changeOfRows(rows: CompareRowStructure[]): {
  change?: CompareChangeKind;
} {
  for (const row of rows) {
    if (
      row.change === "added" ||
      row.change === "removed" ||
      row.change === "moved"
    ) {
      return { change: row.change };
    }
  }
  return rows.length > 0 ? { change: "changed" } : {};
}

function authorIdsOf(rows: CompareRowStructure[]): { authorIds?: string[] } {
  const authorIds = new Set<string>();
  for (const row of rows) {
    for (const id of Object.keys(row.authors)) authorIds.add(id);
  }
  return authorIds.size > 0 ? { authorIds: [...authorIds] } : {};
}

/**
 * Every changed thing in one module, flattened.
 *
 * FLAT rather than the nested tree it comes from, and that is a decision worth
 * stating: a pane is a list of what changed, and a reader scanning it wants
 * one line per change. The nesting in `ChangeTreeNode` is structural — the
 * objects on the way down to a field — so rendering it would put empty rows
 * between the reader and the thing they came for. The label on each row is
 * what says where it sits.
 */
function rowsOf(node: ChangeTreeNode): CompareRowStructure[] {
  const rows: CompareRowStructure[] = [];
  const walk = (current: ChangeTreeNode): void => {
    if (current.change !== undefined) {
      rows.push({
        id: current.sourcePath,
        sourcePath: current.sourcePath as SourcePath,
        label: "",
        change: toChangeKind(current.change.changeType),
        authors: toAuthorship(current.change.patchesByAuthorIds),
        patchIds: current.change.patchIds,
      });
    }
    for (const child of current.children) walk(child);
  };
  walk(node);
  return rows;
}

/**
 * `ChangeTreePatch` carries the module it came from; `AuthorPatchInfo` does
 * not, because the component drawing it is already inside one.
 */
function toAuthorship(
  patchesByAuthorIds: Record<string, { opType: string; createdAt: string }[]>,
): CompareAuthorship {
  const authorship: CompareAuthorship = {};
  for (const [authorId, patches] of Object.entries(patchesByAuthorIds)) {
    authorship[authorId] = patches.map((patch) => ({
      opType: patch.opType,
      createdAt: patch.createdAt,
    }));
  }
  return authorship;
}

/**
 * Where a row sits inside the thing whose pane it is on.
 *
 * `skip` drops the leading segments the pane already says: a page's pane is
 * titled with its route, so repeating the route on every row under it would
 * spend the width that says WHICH field changed on saying the same URL six
 * times.
 */
function trailOf(sourcePath: SourcePath, skip: number): string {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(sourcePath);
  if (!modulePath) return "the whole module";
  const segments = Internal.splitModulePath(modulePath).slice(skip);
  return segments.length === 0 ? "the whole page" : segments.join(" › ");
}
