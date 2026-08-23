import { useEffect, useMemo, useRef, useState } from "react";
import {
  Braces,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Search,
} from "lucide-react";
import { cn } from "../designSystem/cn";
import { ShellData } from "./types";

/** One thing the global search can take you to. */
export type SearchResult = {
  id: string;
  kind: "page" | "external" | "media" | "data";
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
};

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  page: "Pages",
  external: "External pages",
  media: "Media",
  data: "Data",
};

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
  results: SearchResult[];
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
  onSelect,
  onClose,
}: GlobalSearchProps) {
  const [query, setQuery] = useState("");
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
    // Grouped, but kept as one flat list so arrow keys move across groups.
    return GROUP_ORDER.flatMap((kind) =>
      filtered.filter((result) => result.kind === kind),
    ).slice(0, 40);
  }, [results, query]);

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
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto py-1.5">
          {matches.length === 0 ? (
            <p className="px-4 py-6 text-xs text-fg-secondary-alt">
              Nothing matches “{query}”.
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
