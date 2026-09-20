import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  MoreHorizontal,
  Pencil,
  Plus,
} from "lucide-react";
import {
  FloatingPanel,
  PanelEmptyState,
  PanelSectionLabel,
} from "./FloatingPanel";
import {
  PanelErrorState,
  PanelFilterInput,
  PanelRow,
  PanelSkeleton,
} from "./PanelPrimitives";
import {
  ShellBreakpoint,
  ShellExternalPage,
  ShellNewPageRoutes,
  ShellPage,
} from "./types";
import {
  AvailableRoute,
  NewPageForm,
  patternMatchesPath,
} from "../NavMenu/NewPageForm";
import { RouteForm } from "../RouteForm";
import { cn } from "../designSystem/cn";
import { useDismissOnOutsidePointer } from "./useDismissOnOutsidePointer";

/**
 * The header's form, as an id, so one state can hold either it or a row's.
 *
 * One piece of state for every menu and form in the panel, because only one of
 * them may be open: a New page popover and a row's Duplicate popover on screen
 * together are two forms asking the same question about two different pages.
 */
const HEADER_FORM = "\u0000header";
/**
 * How many pages a site can have before the panel stops opening it on sight.
 *
 * Chosen for what fits: the panel is 300px wide and a row is 28px, so about
 * twenty rows fill the visible area of a laptop's panel without scrolling. Past
 * that, opening everything buries the top of the tree rather than revealing it.
 */
const SMALL_SITE = 20;
/** What a row's action button has open: its menu, or one of the two forms. */
type RowForm = "menu" | "duplicate" | "rename";
/** A row's menu or form, keyed by page id, in the same state as the header's. */
const rowForm = (pageId: string, form: RowForm): string =>
  `\u0000${form}:${pageId}`;

/**
 * The New page button, and the form it opens.
 *
 * A popover on the button rather than a modal over the shell: the site map is
 * the context for the decision — which route, and what to call the page — so
 * covering it would be covering the answer. `NewPageForm` is the classic nav
 * menu's, unchanged: it already handles several routes at once, dynamic and
 * catch-all segments, optional segments that mean the base route, the schema
 * author's own description of a key, and telling you when the path is taken.
 */
function NewPageButton({
  routes,
  currentPage,
  isOpen,
  onOpenChange,
  onSubmit,
}: {
  routes: AvailableRoute[];
  /** The page the editor is on, so the form starts on its route. */
  currentPage?: { moduleFilePath: ModuleFilePath; urlPath: string };
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (moduleFilePath: ModuleFilePath, urlPath: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useDismissOnOutsidePointer(containerRef, isOpen, close);
  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="New page"
        aria-expanded={isOpen}
        onClick={() => onOpenChange(!isOpen)}
        className={cn(
          "inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium",
          "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
          isOpen && "bg-bg-float-raised text-fg-primary",
        )}
      >
        <Plus size={13} />
        New
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full z-window mt-1 w-[17rem] rounded-md border border-border-float bg-bg-float shadow-lg">
          <NewPageForm
            routes={routes}
            currentPage={currentPage}
            onSubmit={onSubmit}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A row's own actions: duplicate this page, or change its URL.
 *
 * A menu behind a "…" rather than a button each, because the row is 28px tall
 * and a site map is a list of pages - two icons per row turns it into a list of
 * controls, and there is no reason to stop at two. The menu is a one-click
 * detour to controls nobody needs on every row.
 *
 * Both actions open the SAME form: `RouteForm`, the one the page's own toolbar
 * opens, prefilled with the URL on screen. Duplicating and renaming ask exactly
 * one question and it is the same question - which URL - so the only thing that
 * differs between the two is what the button says and what happens to the
 * original.
 */
function PageActionsButton({
  page,
  route,
  open,
  onOpenChange,
  onDuplicate,
  onRename,
}: {
  page: ShellPage;
  route: AvailableRoute;
  /** Which of this row's things is on screen, if any. */
  open: RowForm | null;
  onOpenChange: (form: RowForm | null) => void;
  /** Absent in a mode that cannot write; the menu then omits the item. */
  onDuplicate?: (toUrlPath: string) => void;
  onRename?: (toUrlPath: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onOpenChange(null), [onOpenChange]);
  useDismissOnOutsidePointer(containerRef, open !== null, close);
  /**
   * Escape dismisses what this row has open - and nothing else.
   *
   * In the CAPTURE phase, and stopping there, because `FloatingPanel` closes
   * the whole Pages panel on Escape and listens for it on `window`, which is
   * the LAST thing a bubbling event reaches. Without this, the one key that
   * should close a menu closes the panel the menu is in.
   */
  useEffect(() => {
    if (open === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, close]);
  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Page actions ${page.urlPath}`}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        onClick={() => onOpenChange(open === null ? "menu" : null)}
        className={cn(
          "grid place-items-center w-6 h-6 rounded text-fg-secondary-alt",
          "hover:bg-bg-float-raised hover:text-fg-primary",
          // Out of the way until the row is pointed at or the control is
          // focused, so a long site map is a list of pages rather than a list
          // of buttons. `focus-visible` so it is reachable by keyboard.
          open !== null
            ? "bg-bg-float-raised text-fg-primary"
            : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
        )}
      >
        <MoreHorizontal size={12} />
      </button>
      {open === "menu" && (
        <div
          role="menu"
          className="absolute right-0 top-full z-window mt-1 w-40 rounded-md border border-border-float bg-bg-float p-1 shadow-lg"
        >
          {onDuplicate && (
            <button
              type="button"
              role="menuitem"
              onClick={() => onOpenChange("duplicate")}
              className="flex items-center gap-2 w-full h-7 px-2 rounded text-xs text-left text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
            >
              <Copy size={12} />
              Duplicate
            </button>
          )}
          {onRename && (
            <button
              type="button"
              role="menuitem"
              onClick={() => onOpenChange("rename")}
              className="flex items-center gap-2 w-full h-7 px-2 rounded text-xs text-left text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
            >
              <Pencil size={12} />
              Rename
            </button>
          )}
        </div>
      )}
      {(open === "duplicate" || open === "rename") && (
        <div className="absolute right-0 top-full z-window mt-1 w-[17rem] rounded-md border border-border-float bg-bg-float p-3 shadow-lg">
          <div className="pb-2 text-sm font-medium text-fg-primary">
            {open === "duplicate" ? "Duplicate page" : "Rename page"}
          </div>
          {open === "rename" && (
            <div className="pb-2 text-xs text-fg-secondary-alt">
              Changes this page&apos;s URL. Links to it are updated.
            </div>
          )}
          <RouteForm
            routePattern={route.routePattern}
            existingKeys={route.existingKeys}
            defaultValue={page.urlPath}
            submitText={open === "duplicate" ? "Duplicate" : "Rename"}
            keyDescription={route.keyDescription}
            onSubmit={(toUrlPath) => {
              if (open === "duplicate") {
                onDuplicate?.(toUrlPath);
              } else {
                onRename?.(toUrlPath);
              }
            }}
            onCancel={close}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The route a page was created under, or null when that cannot be told.
 *
 * Both halves have to agree - the module the page lives in AND a pattern its
 * URL fits - because either alone can name the wrong route: one router module
 * can define several patterns, and two routers can accept the same URL shape.
 * A near miss is worse than nothing here: the form would prefill a page's URL
 * into the segments of a pattern it does not belong to.
 */
export function routeOfPage(
  routes: AvailableRoute[],
  page: ShellPage,
): AvailableRoute | null {
  if (!page.sourcePath) {
    return null;
  }
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
    page.sourcePath as SourcePath,
  );
  return (
    routes.find(
      (route) =>
        route.moduleFilePath === moduleFilePath &&
        patternMatchesPath(route.routePattern, page.urlPath),
    ) ?? null
  );
}

export type PagesPanelProps = {
  breakpoint: ShellBreakpoint;
  pages: ShellPage[];
  externalPages: ShellExternalPage[];
  selectedId: string | null;
  onSelectPage: (page: ShellPage) => void;
  onSelectExternalPage: (page: ShellExternalPage) => void;
  /**
   * Create a page under a route, given the URL that was built for it.
   *
   * The panel does not know what an empty page looks like — that comes from the
   * router's item schema — so it hands back the route and the path and the app
   * writes the patch.
   */
  onNewPage: (moduleFilePath: ModuleFilePath, urlPath: string) => void;
  /**
   * Copy a page to another URL under the same route.
   *
   * The panel does not know what is on the page - that is the whole point of
   * duplicating it rather than making one - so it hands back the two URLs and
   * the app copies the entry. Absent in modes that cannot write, and then the
   * row menu omits the item.
   */
  onDuplicatePage?: (
    moduleFilePath: ModuleFilePath,
    fromUrlPath: string,
    toUrlPath: string,
  ) => void;
  /**
   * Move a page to another URL under the same route.
   *
   * Handed back the same way a duplicate is, and for the same reason: the panel
   * knows which URL was asked for and nothing else. What the app does with it is
   * more than a copy - a rename moves the page out from under everything linking
   * to it, so those have to be rewritten too. See `useRenamePage`. Absent in
   * modes that cannot write, and then the row menu omits the item.
   */
  onRenamePage?: (
    moduleFilePath: ModuleFilePath,
    fromUrlPath: string,
    toUrlPath: string,
  ) => void;
  /**
   * Where a new page can go. Absent when nothing in the project accepts one, and
   * then there is no New button at all: a form whose only answer is "no routes
   * accept new pages" is worse than no button.
   *
   * Duplicate and rename need it too, for the route pattern the URL they ask
   * for has to fit - and a router that accepts no new page accepts no copy of
   * one either.
   */
  newPage?: ShellNewPageRoutes;
  onClose: () => void;
  /** Mobile destination switcher, rendered below the panel header. */
  navSwitcher?: ReactNode;
  /** Show placeholder rows instead of content while data loads. */
  isLoading?: boolean;
  /** Message to show instead of content when the data could not be loaded. */
  loadError?: string;
  onRetryLoad?: () => void;
};

/** The row with this id, anywhere in the tree. */
function findPage(pages: ShellPage[], id: string): ShellPage | undefined {
  for (const page of pages) {
    if (page.id === id) return page;
    const found = findPage(page.children ?? [], id);
    if (found) return found;
  }
  return undefined;
}

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

/**
 * How many PAGES are in this tree — not how many rows are at the top of it.
 *
 * The count beside the label used to be `filtered.length`, and `filterPages`
 * returns a tree rather than a flat list. On any project with a home page at
 * `/`, `toShellPages` nests the entire site under that one root row, so the
 * panel read "Pages 1" no matter how large the site was.
 *
 * Folder rows are excluded. A segment that exists only to hold children has no
 * source path of its own — `isTracked` is exactly that question — and counting
 * them would overstate the site by every intermediate directory in it.
 */
export function countPages(pages: ShellPage[]): number {
  return pages.reduce(
    (total, page) =>
      total + (page.isTracked ? 1 : 0) + countPages(page.children ?? []),
    0,
  );
}

/**
 * The rows that have to be open for `id` to be on screen.
 *
 * A selection made somewhere else — a search result, a deep link, the route
 * the app was opened on — is usually several levels down. Opening its
 * ancestors is the only way the panel can show where you are.
 */
function ancestorsOf(pages: ShellPage[], id: string | null): string[] {
  if (id === null) return [];
  const walk = (items: ShellPage[], trail: string[]): string[] | null => {
    for (const item of items) {
      if (item.id === id) return trail;
      const found = walk(item.children ?? [], [...trail, item.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(pages, []) ?? [];
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
  onDuplicatePage,
  onRenamePage,
  newPage,
  onClose,
  navSwitcher,
  isLoading,
  loadError,
  onRetryLoad,
}: PagesPanelProps) {
  const [query, setQuery] = useState("");
  // Nothing is open by default: a real site map has sections with hundreds of
  // rows, and opening one on mount buries everything else. The exception is
  // the path down to whatever is selected, which has to be visible.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(ancestorsOf(pages, selectedId)),
  );
  /**
   * A small site opens itself.
   *
   * The rule above is about a site map that does not fit; a project with a
   * dozen pages is not that. On any site with a home page at `/`,
   * `toShellPages` nests the whole thing under that one root row — so "nothing
   * is open" meant a panel called Pages showing a single row called Home, which
   * is how someone concludes there is nothing here.
   *
   * Once per tree shape, so collapsing a folder sticks: `pageCount` changing is
   * pages arriving or being added, not somebody closing a row.
   */
  const pageCount = countPages(pages);
  /**
   * Decided once, when the site map first arrives — not on every change to it.
   *
   * This was keyed on the page COUNT, which is not a tree shape: collapse a
   * folder, add a page, and the count changes, so the effect unioned every id
   * back into `expanded` and reopened the folder that had just been closed on
   * purpose. Once the tree has arrived, how it is expanded is the reader's.
   */
  const autoExpanded = useRef(false);
  // Read inside the effect rather than depended on: `pages` is a fresh array
  // on every render, and re-running on it would re-open every folder a moment
  // after it was collapsed. See `restoreRef` in `Shell` for the same shape.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  useEffect(() => {
    if (autoExpanded.current || pageCount === 0) {
      return;
    }
    // The site map is here. Whatever its size, this is the only chance to open
    // it: a project that starts large and is edited down to a dozen pages must
    // not suddenly re-open every folder.
    autoExpanded.current = true;
    if (pageCount > SMALL_SITE) {
      return;
    }
    setExpanded(
      (current) => new Set([...current, ...collectIds(pagesRef.current)]),
    );
  }, [pageCount]);
  // The selection can change from outside the panel — the app's route, a
  // search result — and the panel has to follow it rather than leave the row
  // hidden. Only opening, never closing: a folder you opened stays open.
  const selectedAncestors = useMemo(
    () => ancestorsOf(pages, selectedId).join("\u0000"),
    [pages, selectedId],
  );
  useEffect(() => {
    if (!selectedAncestors) return;
    setExpanded(
      (prev) => new Set([...prev, ...selectedAncestors.split("\u0000")]),
    );
  }, [selectedAncestors]);
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

  /**
   * The page the editor is on, as the New page form wants it.
   *
   * From the selected row rather than passed in, because the row is where both
   * halves already are: its URL, and — inside its source path — the module the
   * router put it in. A row that is only a path segment (`/blogs`, which exists
   * because `/blogs/why-val` does) has no module of its own, so it names no
   * route and the form falls back to the head of the list.
   */
  const currentPage = useMemo(() => {
    const page = selectedId === null ? undefined : findPage(pages, selectedId);
    if (!page?.sourcePath) return undefined;
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
      page.sourcePath as SourcePath,
    );
    return { moduleFilePath, urlPath: page.urlPath };
  }, [pages, selectedId]);

  /** Whether the New page form is open. */
  const [openForm, setOpenForm] = useState<string | null>(null);
  const submitNewPage = useCallback(
    (moduleFilePath: ModuleFilePath, urlPath: string) => {
      setOpenForm(null);
      onNewPage(moduleFilePath, urlPath);
    },
    [onNewPage],
  );
  const submitDuplicatePage = useCallback(
    (route: AvailableRoute, page: ShellPage, toUrlPath: string) => {
      setOpenForm(null);
      onDuplicatePage?.(route.moduleFilePath, page.urlPath, toUrlPath);
    },
    [onDuplicatePage],
  );
  const submitRenamePage = useCallback(
    (route: AvailableRoute, page: ShellPage, toUrlPath: string) => {
      setOpenForm(null);
      onRenamePage?.(route.moduleFilePath, page.urlPath, toUrlPath);
    },
    [onRenamePage],
  );

  const renderPage = (page: ShellPage, depth: number): React.ReactNode => {
    const children = page.children ?? [];
    const hasChildren = children.length > 0;
    const isOpen = forcedExpanded
      ? forcedExpanded.has(page.id)
      : expanded.has(page.id);
    const errorCount = isOpen ? page.errorCount : subtreeErrorCount(page);
    const hasDraft = isOpen ? page.hasDraft : subtreeHasDraft(page);
    // Only a real page under a route Val can name: a row that is only a path
    // segment has nothing to copy or rename, and a route this panel cannot name
    // has no URL to offer for either. See `routeOfPage`.
    const actionsRoute =
      (onDuplicatePage || onRenamePage) && newPage
        ? routeOfPage(newPage.routes, page)
        : null;
    /** Which of this row's menu or forms is open, of the one panel-wide state. */
    const openRowForm: RowForm | null =
      openForm === rowForm(page.id, "menu")
        ? "menu"
        : openForm === rowForm(page.id, "duplicate")
          ? "duplicate"
          : openForm === rowForm(page.id, "rename")
            ? "rename"
            : null;
    return (
      <div key={page.id}>
        <PanelRow
          depth={depth}
          selected={selectedId === page.id}
          title={page.urlPath}
          // A row with children is a disclosure and has to say whether it is
          // open — the media panel's rows always did. It matters more now that
          // a small site map arrives expanded: without this, neither a screen
          // reader nor a test can tell "open it" from "close it".
          expanded={hasChildren ? isOpen : undefined}
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
          action={
            actionsRoute ? (
              <PageActionsButton
                page={page}
                route={actionsRoute}
                open={openRowForm}
                onOpenChange={(form) =>
                  setOpenForm(form === null ? null : rowForm(page.id, form))
                }
                onDuplicate={
                  onDuplicatePage &&
                  ((toUrlPath) =>
                    submitDuplicatePage(actionsRoute, page, toUrlPath))
                }
                onRename={
                  onRenamePage &&
                  ((toUrlPath) =>
                    submitRenamePage(actionsRoute, page, toUrlPath))
                }
              />
            ) : undefined
          }
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
        newPage ? (
          <NewPageButton
            routes={newPage.routes}
            currentPage={currentPage}
            isOpen={openForm === HEADER_FORM}
            onOpenChange={(open) => setOpenForm(open ? HEADER_FORM : null)}
            onSubmit={submitNewPage}
          />
        ) : undefined
      }
      sticky={
        isLoading || loadError ? undefined : (
          <PanelFilterInput
            value={query}
            onChange={setQuery}
            placeholder="Filter pages…"
          />
        )
      }
    >
      {isLoading ? (
        <PanelSkeleton rows={12} />
      ) : loadError ? (
        <PanelErrorState message={loadError} onRetry={onRetryLoad} />
      ) : (
        <div className="pb-3">
          <PanelSectionLabel className="pt-3">
            Pages
            <span className="ml-1.5 font-normal normal-case tracking-normal text-fg-secondary-alt">
              {countPages(filtered)}
            </span>
          </PanelSectionLabel>
          {filtered.length === 0 ? (
            <PanelEmptyState>
              {query
                ? "No pages match this filter."
                : newPage
                  ? "No pages yet. New adds one, under a route a developer has set up."
                  : "No pages yet. A developer adds the routes pages can be created under."}
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
                ? "No external pages match this filter."
                : "No external pages yet. These are links out of the site — a social profile, a help desk — that content can point at."}
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
      )}
    </FloatingPanel>
  );
}
