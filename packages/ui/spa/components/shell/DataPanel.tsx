import { ReactNode, useEffect, useMemo, useState } from "react";
import { Braces, ChevronDown, ChevronRight } from "lucide-react";
import { FloatingPanel, PanelEmptyState } from "./FloatingPanel";
import {
  PanelErrorState,
  PanelFilterInput,
  PanelRow,
  PanelSkeleton,
} from "./PanelPrimitives";
import { ShellBreakpoint, ShellDataModule } from "./types";

export type DataPanelProps = {
  breakpoint: ShellBreakpoint;
  data: ShellDataModule[];
  selectedId: string | null;
  onSelect: (module: ShellDataModule) => void;
  onClose: () => void;
  /** Mobile destination switcher, rendered below the panel header. */
  navSwitcher?: ReactNode;
  /** Show placeholder rows instead of content while data loads. */
  isLoading?: boolean;
  /** Message to show instead of content when the data could not be loaded. */
  loadError?: string;
  onRetryLoad?: () => void;
};

/**
 * A directory in the Data tree, or a val module in one.
 *
 * Directories are not data the shell is given — they are implied by the module
 * paths, which is why this is derived here rather than carried through
 * `ShellData`. A module's path is the whole truth about where it lives, so a
 * separate tree alongside the list could only ever disagree with it.
 */
type DataNode =
  | {
      kind: "directory";
      /** Full path of the directory, e.g. `/content`. Unique, so it is the id. */
      id: string;
      name: string;
      children: DataNode[];
    }
  | { kind: "module"; id: string; module: ShellDataModule };

/** The modules, as the directory tree their paths describe. */
function buildTree(modules: ShellDataModule[]): DataNode[] {
  const roots: DataNode[] = [];
  // Directories are looked up by full path while building so the same
  // directory is created once however many modules are in it.
  const directories = new Map<string, Extract<DataNode, { kind: "directory" }>>(
    [],
  );

  for (const module of modules) {
    const segments = module.moduleFilePath.split("/").filter(Boolean);
    // The last segment is the file; everything before it is directories.
    const directorySegments = segments.slice(0, -1);
    let siblings = roots;
    let path = "";
    for (const segment of directorySegments) {
      path = `${path}/${segment}`;
      let directory = directories.get(path);
      if (!directory) {
        directory = {
          kind: "directory",
          id: path,
          name: segment,
          children: [],
        };
        directories.set(path, directory);
        siblings.push(directory);
      }
      siblings = directory.children;
    }
    siblings.push({ kind: "module", id: module.id, module });
  }
  return roots;
}

/** Directories first, then modules; each group by name. */
function sortTree(nodes: DataNode[]): DataNode[] {
  const sorted = [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    const aName = a.kind === "directory" ? a.name : a.module.name;
    const bName = b.kind === "directory" ? b.name : b.module.name;
    return aName.localeCompare(bName);
  });
  return sorted.map((node) =>
    node.kind === "directory"
      ? { ...node, children: sortTree(node.children) }
      : node,
  );
}

/** Every directory in the tree, so they can all start open. */
function directoryIds(nodes: DataNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "directory" ? [node.id, ...directoryIds(node.children)] : [],
  );
}

/** The directories that have to be open for `id` to be on screen. */
function ancestorsOf(nodes: DataNode[], id: string | null): string[] {
  if (id === null) return [];
  const walk = (items: DataNode[], trail: string[]): string[] | null => {
    for (const item of items) {
      if (item.id === id) return trail;
      if (item.kind === "directory") {
        const found = walk(item.children, [...trail, item.id]);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}

/**
 * Non-router val modules: settings, navigation, records, lookup tables.
 *
 * Shown as the tree the files are actually in rather than as a flat list. A
 * project with a `/content` directory and a couple of modules beside it reads
 * as one list either way, but the moment a project organises its content into
 * folders — which is the reason to have folders — a flat list stops saying
 * where anything is, and two modules with the same file name become two
 * identical rows.
 */
export function DataPanel({
  breakpoint,
  data,
  selectedId,
  onSelect,
  onClose,
  navSwitcher,
  isLoading,
  loadError,
  onRetryLoad,
}: DataPanelProps) {
  const [query, setQuery] = useState("");
  const tree = useMemo(() => sortTree(buildTree(data)), [data]);

  /**
   * Directories start open.
   *
   * The opposite of the site map, and for the opposite reason: a project has
   * far fewer val modules than pages, and the whole point of the tree is to
   * show where they are. This is also what the previous explorer did.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // A selection made elsewhere — a deep link, a search result — has to be
  // visible, so its directories are re-opened if they were collapsed.
  // `\u0000` as the separator, written as an escape rather than as the raw byte
  // it used to be: a literal NUL in the source makes git treat this file as
  // binary, so no change to it can be read as a diff.
  const selectedAncestors = useMemo(
    () => ancestorsOf(tree, selectedId).join("\u0000"),
    [tree, selectedId],
  );
  useEffect(() => {
    if (!selectedAncestors) return;
    const reopen = selectedAncestors.split("\u0000");
    setCollapsed((current) => {
      if (!reopen.some((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of reopen) next.delete(id);
      return next;
    });
  }, [selectedAncestors]);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  /** Modules whose name or path matches, keeping the directories above them. */
  const filtered = useMemo(() => {
    if (!query) return tree;
    const q = query.toLowerCase();
    const walk = (nodes: DataNode[]): DataNode[] =>
      nodes.flatMap((node): DataNode[] => {
        if (node.kind === "module") {
          const matches =
            node.module.name.toLowerCase().includes(q) ||
            node.module.moduleFilePath.toLowerCase().includes(q);
          return matches ? [node] : [];
        }
        const children = walk(node.children);
        // A directory whose own name matches is kept even when nothing in it
        // does: filtering to "content" should show the content folder.
        if (children.length === 0 && !node.name.toLowerCase().includes(q)) {
          return [];
        }
        return [{ ...node, children }];
      });
    return walk(tree);
  }, [tree, query]);

  // A result nobody can see is not a result: while filtering, everything that
  // survived is forced open.
  const forcedOpen = useMemo(
    () => (query ? new Set(directoryIds(filtered)) : null),
    [query, filtered],
  );

  const moduleCount = data.length;

  const renderNode = (node: DataNode, depth: number): ReactNode => {
    if (node.kind === "module") {
      return (
        <PanelRow
          key={node.id}
          depth={depth}
          selected={selectedId === node.id}
          title={node.module.moduleFilePath}
          onClick={() => onSelect(node.module)}
          leading={<Braces size={13} className="text-fg-secondary-alt" />}
          label={node.module.name}
          errorCount={node.module.errorCount}
          hasDraft={node.module.hasDraft}
        />
      );
    }
    const isOpen = forcedOpen
      ? forcedOpen.has(node.id)
      : !collapsed.has(node.id);
    return (
      <div key={node.id}>
        <PanelRow
          depth={depth}
          title={node.id}
          onClick={() => {
            if (!forcedOpen) toggle(node.id);
          }}
          // The chevron alone, as in the Pages panel: the leading slot is one
          // icon wide, and a second icon in it overlaps the label.
          leading={
            <span className="text-fg-secondary-alt">
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
          }
          label={node.name}
          // Collapsed, a directory has to account for what is inside it.
          errorCount={isOpen ? undefined : subtreeErrorCount(node)}
          hasDraft={isOpen ? undefined : subtreeHasDraft(node)}
        />
        {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <FloatingPanel
      side="left"
      width={300}
      title="Data"
      mobileVariant="sheet"
      breakpoint={breakpoint}
      onClose={onClose}
      subheader={navSwitcher}
      sticky={
        isLoading || loadError ? undefined : (
          <PanelFilterInput
            value={query}
            onChange={setQuery}
            placeholder="Filter data files…"
          />
        )
      }
    >
      <div className="py-2">
        {isLoading ? (
          <PanelSkeleton />
        ) : loadError ? (
          <PanelErrorState message={loadError} onRetry={onRetryLoad} />
        ) : moduleCount === 0 ? (
          <PanelEmptyState>
            No data files yet. Data is the content that is not tied to one page.
          </PanelEmptyState>
        ) : filtered.length === 0 ? (
          <PanelEmptyState>No data files match this filter.</PanelEmptyState>
        ) : (
          filtered.map((node) => renderNode(node, 0))
        )}
      </div>
    </FloatingPanel>
  );
}

/** Errors on everything below a directory — what a collapsed row must show. */
function subtreeErrorCount(node: DataNode): number | undefined {
  const total =
    node.kind === "module"
      ? (node.module.errorCount ?? 0)
      : node.children.reduce(
          (sum, child) => sum + (subtreeErrorCount(child) ?? 0),
          0,
        );
  return total === 0 ? undefined : total;
}

function subtreeHasDraft(node: DataNode): boolean | undefined {
  const has =
    node.kind === "module"
      ? node.module.hasDraft === true
      : node.children.some((child) => subtreeHasDraft(child) === true);
  return has ? true : undefined;
}
