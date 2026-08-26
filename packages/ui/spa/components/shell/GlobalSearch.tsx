import { useEffect, useMemo, useRef, useState } from "react";
import {
  Braces,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  History,
  Search,
  TextSearch,
} from "lucide-react";
import { cn } from "../designSystem/cn";
import { ShellData } from "./types";

/** One thing the global search can take you to. */
export type SearchResult = {
  /**
   * What selecting this row opens.
   *
   * For a navigation row it is the row's id, which is also its path. For a
   * content hit it is the source path of the field that matched — deeper than
   * any row, which is the point of finding it.
   */
  id: string;
  kind: "page" | "external" | "media" | "data" | "content" | "recent";
  /** What the row shows. */
  label: string;
  /** Secondary line: url path, directory or module file path. */
  detail: string;
};

const KIND_ICON: Record<SearchResult["kind"], typeof FileText> = {
  page: FileText,
  external: ExternalLink,
  media: ImageIcon,
  data: Braces,
  content: TextSearch,
  recent: History,
};

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  page: "Pages",
  external: "External pages",
  media: "Media",
  data: "Data",
  content: "In content",
  recent: "Recently changed",
};

/**
 * The navigation groups, in the order they are shown.
 *
 * `content` is not here: it is not filtered locally and it always comes last,
 * so it is appended rather than being one of the groups walked over.
 */
const GROUP_ORDER: SearchResult["kind"][] = [
  "page",
  "data",
  "media",
  "external",
];

/** Everything navigable in the project, flattened into search rows. */
export function collectSearchResults(data: ShellData): SearchResult[] {
  const results: SearchResult[] = [];
  const walkPages = (pages: ShellData["pages"]) => {
    for (const page of pages) {
      results.push({
        id: page.id,
        kind: "page",
        label: page.name,
        detail: page.urlPath,
      });
      walkPages(page.children ?? []);
    }
  };
  walkPages(data.pages);
  for (const module of data.data) {
    results.push({
      id: module.id,
      kind: "data",
      label: module.name,
      detail: module.moduleFilePath,
    });
  }
  for (const gallery of data.media) {
    results.push({
      id: gallery.id,
      kind: "media",
      label: gallery.name,
      detail: gallery.directory,
    });
  }
  for (const page of data.externalPages) {
    results.push({
      id: page.id,
      kind: "external",
      label: page.name,
      detail: page.url,
    });
  }
  return results;
}

export type GlobalSearchProps = {
  /**
   * The places you can go: pages, data modules, galleries, external links.
   *
   * Filtered here, on the client, by name and path. That is the right shape for
   * "take me to Pricing" — the list is small and the answer is instant.
   */
  results: SearchResult[];
  /**
   * Content matches, from Val's own index.
   *
   * A separate input because it is a genuinely different search: it looks
   * *inside* the content, so it answers "which page says `asked`" — which no
   * amount of filtering over row names ever can. It arrives asynchronously and
   * is already filtered by the query, so it is not filtered again here.
   */
  contentResults?: SearchResult[];
  /**
   * The last few things that changed, newest first.
   *
   * Offered for the empty query only, above everything else. Opening search
   * without typing is most often "take me back to what I was just editing", and
   * a list of every page in the project does not answer that — it answers "take
   * me somewhere", which is what typing is for.
   */
  recentResults?: SearchResult[];
  /** True while the content index is still answering, or still filling. */
  isSearchingContent?: boolean;
  /** Called as the query changes, so the app can run the content search. */
  onQueryChange?: (query: string) => void;
  onSelect: (result: SearchResult) => void;
  onClose: () => void;
};

/**
 * Search across the whole project, from anywhere.
 *
 * A centred overlay rather than a panel: it is not tied to a destination, so
 * it should not look like one. Opened with ⌘K / Ctrl+K, driven entirely from
 * the keyboard, and it closes as soon as it has taken you somewhere.
 */
export function GlobalSearch({
  results,
  contentResults,
  recentResults,
  isSearchingContent,
  onQueryChange,
  onSelect,
  onClose,
}: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  // The content search is the app's to run, and it needs the query. Reported
  // from an effect rather than from the input's handler so it also fires for
  // the empty query, which is what clears the previous answer.
  useEffect(() => {
    onQueryChange?.(query);
  }, [query, onQueryChange]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? results.filter(
          (result) =>
            result.label.toLowerCase().includes(q) ||
            result.detail.toLowerCase().includes(q),
        )
      : results;
    /**
     * Navigation first, then content.
     *
     * Someone typing a page's name wants that page, not the first paragraph
     * that happens to mention it. Content hits are deduplicated against the
     * navigation rows so a page does not appear twice for the same query.
     */
    const navigation = GROUP_ORDER.flatMap((kind) =>
      filtered.filter((result) => result.kind === kind),
    );
    const seen = new Set(navigation.map((result) => result.id));
    const content = (q ? (contentResults ?? []) : []).filter(
      (result) => !seen.has(result.id),
    );
    // Recently changed answers the empty query and nothing else: once there is
    // a query, what you asked for beats what you happened to touch last.
    const recent = q ? [] : (recentResults ?? []);
    // Kept as one flat list so arrow keys move across the groups.
    return [...recent, ...navigation, ...content].slice(0, 40);
  }, [results, contentResults, recentResults, query]);

  // A stale highlight after retyping would send Enter somewhere unexpected.
  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((current) => {
          if (matches.length === 0) return 0;
          const next = e.key === "ArrowDown" ? current + 1 : current - 1;
          return (next + matches.length) % matches.length;
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const result = matches[activeIndex];
        if (result) onSelect(result);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [matches, activeIndex, onSelect, onClose]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  let lastKind: SearchResult["kind"] | null = null;
  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="absolute inset-0 z-overlay bg-black/50"
      />
      <div
        role="dialog"
        aria-label="Search"
        className="absolute z-overlay left-1/2 -translate-x-1/2 top-[12svh] w-[min(34rem,calc(100vw-1.5rem))] max-h-[70svh] flex flex-col rounded-xl bg-bg-float border border-border-float shadow-xl overflow-hidden"
      >
        <div className="flex items-center gap-2 h-11 px-3 border-b border-border-float shrink-0">
          <Search size={15} className="shrink-0 text-fg-secondary-alt" />
          <input
            // The overlay exists only to be typed into.
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, media and data…"
            aria-label="Search the project"
            className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none placeholder:text-fg-secondary-alt"
          />
          <kbd className="shrink-0 px-1.5 py-0.5 rounded border border-border-float text-[0.625rem] text-fg-secondary-alt font-sans">
            esc
          </kbd>
        </div>
        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-y-auto py-1.5 scrollbar-slim"
        >
          {matches.length === 0 ? (
            <p className="px-4 py-6 text-xs text-fg-secondary-alt">
              {isSearchingContent
                ? "Searching…"
                : `Nothing matches “${query}”.`}
            </p>
          ) : (
            matches.map((result, index) => {
              const Icon = KIND_ICON[result.kind];
              const showGroup = result.kind !== lastKind;
              lastKind = result.kind;
              return (
                <div key={`${result.kind}-${result.id}`}>
                  {showGroup && (
                    <div className="px-4 pt-2.5 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-secondary-alt">
                      {KIND_LABEL[result.kind]}
                    </div>
                  )}
                  <button
                    type="button"
                    data-active={index === activeIndex}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => onSelect(result)}
                    className={cn(
                      "flex items-center gap-2.5 w-full px-3 py-1.5 mx-1.5 rounded-md text-left",
                      "w-[calc(100%-0.75rem)]",
                      index === activeIndex
                        ? "bg-bg-float-raised"
                        : "hover:bg-bg-float-raised",
                    )}
                  >
                    <Icon
                      size={14}
                      className={cn(
                        "shrink-0",
                        index === activeIndex
                          ? "text-fg-primary"
                          : "text-fg-secondary-alt",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-fg-primary truncate">
                        {result.label}
                      </span>
                      <span className="block text-[0.6875rem] text-fg-secondary-alt truncate">
                        {result.detail}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })
          )}
          {/*
           * Said while results are already on screen, because content hits
           * arrive after the navigation rows and can keep arriving: a
           * `.jsonValues()` index fills in batches, so an answer at 20% is not
           * the final one. Without this the list looks complete when it is not.
           */}
          {isSearchingContent && matches.length > 0 && (
            <p className="flex items-center gap-1.5 px-4 py-2 text-[0.6875rem] text-fg-secondary-alt">
              <Loader2 size={11} className="animate-spin" />
              Still searching content…
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 h-8 px-3 shrink-0 border-t border-border-float text-[0.625rem] text-fg-secondary-alt">
          <span>↑↓ to navigate</span>
          <span>↵ to open</span>
        </div>
      </div>
    </>
  );
}

/**
 * Opens the global search on ⌘K / Ctrl+K — the shortcut Val already uses —
 * except while the user is typing somewhere else.
 */
export function useGlobalSearchShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key !== "k" ||
        !(e.metaKey || e.ctrlKey) ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}
