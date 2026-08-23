import { ReactNode, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  Plus,
} from "lucide-react";
import {
  FloatingPanel,
  PanelEmptyState,
  PanelSectionLabel,
} from "./FloatingPanel";
import { PanelRow, PanelFilterInput } from "./PanelPrimitives";
import { ShellBreakpoint, ShellExternalPage, ShellPage } from "./types";

export type PagesPanelProps = {
  breakpoint: ShellBreakpoint;
  pages: ShellPage[];
  externalPages: ShellExternalPage[];
  selectedId: string | null;
  onSelectPage: (page: ShellPage) => void;
  onSelectExternalPage: (page: ShellExternalPage) => void;
  onNewPage: () => void;
  onClose: () => void;
  /** Mobile destination switcher, rendered below the panel header. */
  navSwitcher?: ReactNode;
};

/** Pages whose name or URL matches the query, keeping ancestors of matches. */
function filterPages(pages: ShellPage[], query: string): ShellPage[] {
  if (!query) return pages;
  const q = query.toLowerCase();
  const walk = (items: ShellPage[]): ShellPage[] =>
    items.flatMap((item) => {
      const children = walk(item.children ?? []);
      const selfMatches =
        item.name.toLowerCase().includes(q) ||
        item.urlPath.toLowerCase().includes(q);
      if (!selfMatches && children.length === 0) return [];
      return [{ ...item, children }];
    });
  return walk(pages);
}

function collectIds(pages: ShellPage[]): string[] {
  return pages.flatMap((page) => [page.id, ...collectIds(page.children ?? [])]);
}

/** Errors on a page and everything below it — what a collapsed row has to show. */
function subtreeErrorCount(page: ShellPage): number {
  return (
    (page.errorCount ?? 0) +
    (page.children ?? []).reduce((sum, c) => sum + subtreeErrorCount(c), 0)
  );
}

function subtreeHasDraft(page: ShellPage): boolean {
  return (
    page.hasDraft === true ||
    (page.children ?? []).some((c) => subtreeHasDraft(c))
  );
}

/**
 * The Pages panel: the site map first, external pages last.
 *
 * Both live here because both are pages as far as an editor is concerned —
 * "the Instagram link" is looked for under Pages, not under a separate
 * top-level destination. External pages go at the end because the site map is
 * what people came for, and a real project has a long tail of both.
 */
export function PagesPanel({
  breakpoint,
  pages,
  externalPages,
  selectedId,
  onSelectPage,
  onSelectExternalPage,
  onNewPage,
  onClose,
  navSwitcher,
}: PagesPanelProps) {
  const [query, setQuery] = useState("");
  // Top-level sections start open; deeper folders stay collapsed so a project
  // with a hundred blog posts does not bury everything else.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(["features"]),
  );
  const filtered = useMemo(() => filterPages(pages, query), [pages, query]);
  // A search result nobody can see is not a result: while searching, every
  // surviving folder is forced open.
  const forcedExpanded = useMemo(
    () => (query ? new Set(collectIds(filtered)) : null),
    [query, filtered],
  );
  const filteredExternal = useMemo(() => {
    if (!query) return externalPages;
    const q = query.toLowerCase();
    return externalPages.filter(
      (page) =>
        page.name.toLowerCase().includes(q) ||
        page.url.toLowerCase().includes(q),
    );
  }, [externalPages, query]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderPage = (page: ShellPage, depth: number): React.ReactNode => {
    const children = page.children ?? [];
    const hasChildren = children.length > 0;
    const isOpen = forcedExpanded
      ? forcedExpanded.has(page.id)
      : expanded.has(page.id);
    const errorCount = isOpen ? page.errorCount : subtreeErrorCount(page);
    const hasDraft = isOpen ? page.hasDraft : subtreeHasDraft(page);
    return (
      <div key={page.id}>
        <PanelRow
          depth={depth}
          selected={selectedId === page.id}
          title={page.urlPath}
          onClick={() => {
            onSelectPage(page);
            if (hasChildren && !forcedExpanded) toggle(page.id);
          }}
          leading={
            hasChildren ? (
              <span
                role="presentation"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(page.id);
                }}
                className="text-fg-secondary-alt"
              >
                {isOpen ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronRight size={13} />
                )}
              </span>
            ) : depth === 0 ? (
              <File size={13} className="text-fg-secondary-alt" />
            ) : (
              <span className="w-3.5" />
            )
          }
          label={page.name}
          errorCount={errorCount}
          hasDraft={hasDraft}
        />
        {isOpen &&
          hasChildren &&
          children.map((child) => renderPage(child, depth + 1))}
      </div>
    );
  };

  return (
    <FloatingPanel
      side="left"
      width={300}
      title="Pages"
      mobileVariant="sheet"
      breakpoint={breakpoint}
      onClose={onClose}
      subheader={navSwitcher}
      headerAction={
        <button
          type="button"
          onClick={onNewPage}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
        >
          <Plus size={13} />
          New
        </button>
      }
      sticky={
        <PanelFilterInput
          value={query}
          onChange={setQuery}
          placeholder="Filter pages…"
        />
      }
    >
      <div className="pb-3">
        <PanelSectionLabel className="pt-3">
          Pages
          <span className="ml-1.5 font-normal normal-case tracking-normal text-fg-secondary-alt">
            {filtered.length}
          </span>
        </PanelSectionLabel>
        {filtered.length === 0 ? (
          <PanelEmptyState>
            {query ? "No pages match your search." : "No pages yet."}
          </PanelEmptyState>
        ) : (
          filtered.map((page) => renderPage(page, 0))
        )}

        <PanelSectionLabel>
          External pages
          <span className="ml-1.5 font-normal normal-case tracking-normal text-fg-secondary-alt">
            {filteredExternal.length}
          </span>
        </PanelSectionLabel>
        {filteredExternal.length === 0 ? (
          <PanelEmptyState>
            {query
              ? "No external pages match your search."
              : "No external pages yet."}
          </PanelEmptyState>
        ) : (
          filteredExternal.map((page) => (
            <PanelRow
              key={page.id}
              selected={selectedId === page.id}
              title={page.url}
              onClick={() => onSelectExternalPage(page)}
              leading={
                <ExternalLink size={12} className="text-fg-secondary-alt" />
              }
              label={page.name}
              errorCount={page.errorCount}
            />
          ))
        )}
      </div>
    </FloatingPanel>
  );
}
