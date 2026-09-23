import { Internal, type ModuleFilePath, type SourcePath } from "@valbuild/core";
import type {
  ChangeTreeNode,
  ChangeType,
} from "../utils/computeChangedSourcePaths";
import { buildDataTree } from "./navTree";
import type {
  CompareAuthorship,
  CompareChangeKind,
  CompareNavNode,
  CompareNavSection,
} from "./types";

/**
 * A publish, as the compare dialog's SHAPE — without a pixel of it.
 *
 * Split from `useCompareModel` for the reason `shellDataMapping` gives, plus
 * one specific to this view: `CompareModel` carries `before`/`after` as
 * `ReactNode`, so a function producing one directly could only be tested by
 * rendering it. What is worth testing here is not the pixels but the
 * decisions — which nav section a module lands in, which rows a pane holds,
 * what counts as one change — and those are all here, as paths.
 *
 * `useCompareModel` is the thin half that hangs a value renderer on each path.
 */
export type CompareStructure = {
  sections: CompareNavSection[];
  /** Keyed by nav node id, like `CompareModel.panes`. */
  panes: Record<string, ComparePaneStructure>;
  /** Total changed things, for the count under the dialog title. */
  changeCount: number;
};

export type ComparePaneStructure = {
  /** The module this pane is of — its heading, and its `path`. */
  moduleFilePath: ModuleFilePath;
  change?: CompareChangeKind;
  rows: CompareRowStructure[];
};

export type CompareRowStructure = {
  id: string;
  /** The path whose value the two sides render. */
  sourcePath: SourcePath;
  /** The path under the module, as the row's label. */
  label: string;
  change: CompareChangeKind;
  authors: CompareAuthorship;
  /** The patches behind it, which is what an undo would drop. */
  patchIds: string[];
};

/**
 * `ChangeType` is what the patch ops said happened; `CompareChangeKind` is
 * what a reader is shown. The only one that is not a rename is `field-change`,
 * which is "changed" — the word the view's badge and rails are written for.
 */
function toChangeKind(changeType: ChangeType): CompareChangeKind {
  return changeType === "field-change" ? "changed" : changeType;
}

export function toCompareStructure(trees: ChangeTreeNode[]): CompareStructure {
  const panes: Record<string, ComparePaneStructure> = {};
  const pageModules: ChangeTreeNode[] = [];
  const dataModules: ChangeTreeNode[] = [];
  let changeCount = 0;

  for (const tree of trees) {
    const moduleFilePath = tree.sourcePath as ModuleFilePath;
    const rows = rowsOf(tree, moduleFilePath);
    changeCount += rows.length;
    panes[navNodeId(moduleFilePath)] = {
      moduleFilePath,
      ...(tree.change ? { change: toChangeKind(tree.change.changeType) } : {}),
      rows,
    };
    /*
     * A page module goes in the Pages section, everything else in Data — the
     * same two names the Studio's own panels use, because the nav is a second
     * view of the same places and a third word for one of them would be a
     * third place to look.
     *
     * Decided by the path rather than by the schema, deliberately: this
     * function is pure and a schema lookup would make it a hook. `isPageRouter`
     * is the real answer and the caller can override with it; this is the
     * fallback that gets `/app/**` right, which is every Next project.
     */
    (isPagePath(moduleFilePath) ? pageModules : dataModules).push(tree);
  }

  const sections: CompareNavSection[] = [];
  if (pageModules.length > 0) {
    sections.push({
      id: "pages",
      title: "Pages",
      nodes: pageModules.map((tree) => moduleNavNode(tree, "page")),
    });
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
        dataModules.map((tree) => ({
          moduleFilePath: tree.sourcePath,
          node: moduleNavNodeBase(tree),
        })),
      ),
    });
  }
  return { sections, panes, changeCount };
}

/** The nav id for a module, and the key its pane is stored under. */
export function navNodeId(moduleFilePath: string): string {
  return `module:${moduleFilePath}`;
}

function moduleNavNodeBase(
  tree: ChangeTreeNode,
): Omit<CompareNavNode, "label" | "kind" | "children"> {
  const rows = rowsOf(tree, tree.sourcePath as ModuleFilePath);
  const authorIds = new Set<string>();
  for (const row of rows) {
    for (const id of Object.keys(row.authors)) authorIds.add(id);
  }
  return {
    id: navNodeId(tree.sourcePath),
    ...(tree.change ? { change: toChangeKind(tree.change.changeType) } : {}),
    changedCount: rows.length,
    ...(authorIds.size > 0 ? { authorIds: [...authorIds] } : {}),
  };
}

function moduleNavNode(
  tree: ChangeTreeNode,
  kind: "page" | "module",
): CompareNavNode {
  return {
    ...moduleNavNodeBase(tree),
    label: fileLabelOf(tree.sourcePath),
    kind,
  };
}

/**
 * Every changed thing in one module, flattened.
 *
 * FLAT rather than the nested tree it comes from, and that is a decision worth
 * stating: the pane is a list of what changed in this module, and a reader
 * scanning it wants one line per change. The nesting in `ChangeTreeNode` is
 * structural — the objects on the way down to a field — so rendering it would
 * put empty rows between the reader and the thing they came for. The path on
 * each row is what says where it sits.
 */
function rowsOf(
  node: ChangeTreeNode,
  moduleFilePath: ModuleFilePath,
): CompareRowStructure[] {
  const rows: CompareRowStructure[] = [];
  const walk = (current: ChangeTreeNode): void => {
    if (current.change !== undefined) {
      rows.push({
        id: current.sourcePath,
        sourcePath: current.sourcePath as SourcePath,
        label: labelOf(current.sourcePath, moduleFilePath),
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

/** The path under the module — "the whole module" at its root. */
function labelOf(sourcePath: string, moduleFilePath: ModuleFilePath): string {
  if (sourcePath === moduleFilePath) return "the whole module";
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    sourcePath as SourcePath,
  );
  return modulePath ? Internal.splitModulePath(modulePath).join(" › ") : "";
}

/** `/content/products.val.ts` -> `products`. As the Data panel names a row. */
function fileLabelOf(moduleFilePath: string): string {
  const file = moduleFilePath.split("/").pop() ?? moduleFilePath;
  return file.replace(/\.val\.(ts|js)$/, "");
}

/**
 * Whether this module's keys name routes of the site.
 *
 * A path test, because this file is pure. `isPageRouter` reads the SCHEMA and
 * is the real answer — `useCompareModel` passes what it decides in, and this
 * is only the fallback for a caller that has no schemas yet.
 */
function isPagePath(moduleFilePath: string): boolean {
  return (
    moduleFilePath.startsWith("/app/") || moduleFilePath.startsWith("/src/")
  );
}
