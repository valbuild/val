import { fileLabel } from "../components/shell/shellDataMapping";
import type { CompareNavNode } from "./types";

/**
 * The Data section of the compare nav, as the directory tree its paths describe.
 *
 * The same shape `DataPanel` builds, for the same reason its header gives: a
 * module's path is the whole truth about where it lives, so directories are
 * derived here rather than carried in the model. A separate tree alongside the
 * paths could only ever disagree with them.
 *
 * Names come from `fileLabel` and `directoryName` — the functions the Data
 * panel itself uses — rather than from anything local. That is the point of
 * importing them: a change to how a module is named has one place to happen.
 * Note that this is deliberately NOT `describePath`: the nav is a location (see
 * `CompareNav`'s header), so it takes the path's own segments, and a module
 * named `authors.val.ts` reads `authors` here exactly as it does under Data.
 */

/** One changed module, as the caller knows it. */
export type ChangedModule = {
  moduleFilePath: string;
  /** Everything the nav row needs that is not derived from the path. */
  node: Omit<CompareNavNode, "label" | "kind" | "children">;
};

/**
 * Directory chains with nothing to show at each level are drawn as one row.
 *
 * VS Code calls this compact folders, and the case it exists for is the case
 * this tree is full of: the compare nav holds only what CHANGED, so a single
 * edit deep in a structured project produces a column of folders with one child
 * each. `/content/shop/shipping/rates.val.ts` alone is four rows to say one
 * thing; compacted it is two.
 *
 * The rule is exactly VS Code's: a directory merges into its child when it has
 * ONE child and that child is a directory. A directory whose only child is a
 * file does not merge — `shipping / rates` would read as a path to a directory
 * called `rates`, and it would hide the boundary between where a file lives and
 * what it is called.
 *
 * Merging is a fixed point, so `a → b → c → file` becomes `a / b / c`.
 */
const SEPARATOR = " / ";

export function buildDataTree(modules: ChangedModule[]): CompareNavNode[] {
  return compact(sortTree(build(modules)));
}

type Building = {
  node: CompareNavNode;
  /** Only directories have this; a module is a leaf by construction. */
  children?: Building[];
};

function build(modules: ChangedModule[]): Building[] {
  const roots: Building[] = [];
  /*
   * Looked up by full path while building, so two modules in the same directory
   * meet the same node rather than each creating one. Keyed by path and not by
   * segment for the obvious reason: `/content/shop` and `/schema/shop` are two
   * directories that happen to share a name.
   */
  const directories = new Map<string, Building>();

  for (const module of modules) {
    const segments = module.moduleFilePath.split("/").filter(Boolean);
    const directorySegments = segments.slice(0, -1);
    let siblings = roots;
    let path = "";
    for (const segment of directorySegments) {
      path = `${path}/${segment}`;
      let directory = directories.get(path);
      if (directory === undefined) {
        directory = {
          node: { id: path, label: segment, kind: "folder" },
          children: [],
        };
        directories.set(path, directory);
        siblings.push(directory);
      }
      siblings = directory.children ?? [];
    }
    siblings.push({
      node: {
        ...module.node,
        label: fileLabel(module.moduleFilePath),
        kind: "module",
      },
    });
  }
  return roots;
}

/** Directories first, then modules; each group by name — as `DataPanel` sorts. */
function sortTree(nodes: Building[]): Building[] {
  return [...nodes]
    .sort((a, b) => {
      const aDir = a.children !== undefined;
      const bDir = b.children !== undefined;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.node.label.localeCompare(b.node.label);
    })
    .map((entry) =>
      entry.children === undefined
        ? entry
        : { ...entry, children: sortTree(entry.children) },
    );
}

function compact(nodes: Building[]): CompareNavNode[] {
  return nodes.map((entry) => {
    if (entry.children === undefined) {
      return entry.node;
    }
    let label = entry.node.label;
    let id = entry.node.id;
    let children = entry.children;
    /*
     * Walk down while the only child is a directory, taking its name with us.
     * The id follows the DEEPEST directory, because that is the path the row
     * now stands for — a row reading `shop / shipping` that identified itself
     * as `/content/shop` would select and expand the wrong thing.
     */
    while (children.length === 1 && children[0].children !== undefined) {
      const only = children[0];
      label = `${label}${SEPARATOR}${only.node.label}`;
      id = only.node.id;
      children = only.children ?? [];
    }
    return {
      ...entry.node,
      id,
      label,
      children: compact(children),
    };
  });
}

/**
 * How many rows a subtree would draw, for the count on a collapsed row.
 *
 * Counts MODULES, not rows: a folder that says "3" beside a compacted label is
 * answering "how many changed things are in here", and counting the directories
 * it merged on the way down would inflate it with rows nobody can click.
 */
export function countModules(nodes: CompareNavNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total +
      (node.children === undefined ? 1 : countModules(node.children ?? [])),
    0,
  );
}
