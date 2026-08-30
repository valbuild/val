import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useGetNavPath } from "./ValFieldProvider";
import { useValSystem } from "../stores/react/SystemContext";
import { useNavigation } from "./ValRouter";
import { Command, CommandInput } from "./designSystem/command";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTrigger,
} from "./designSystem/dialog";
import * as DialogPrimitive from "./designSystem/dialog-primitive";
import { Search as SearchIcon } from "lucide-react";
import { cn } from "./designSystem/cn";
import { SearchResultsList, type SearchResult } from "./SearchResultsList";
import { useAllJsonValuesLoad } from "./useJsonValuesLoad";

export function Search({ container }: { container?: HTMLElement }) {
  const [open, setOpen] = useState(false);
  const searchTriggerRef = useRef<HTMLDivElement>(null);

  // Handle Cmd+K (Mac) or Ctrl+K (other platforms) to activate search
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Cmd+K (Mac) or Ctrl+K (other platforms)
      if (
        event.key === "k" &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        // Don't activate if user is typing in an input/textarea
        const target = event.target as HTMLElement;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }

        event.preventDefault();
        setOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  const { navigate } = useNavigation();

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <div className="relative" ref={searchTriggerRef}>
        <DialogTrigger className="w-full" onClick={() => setOpen(true)}>
          <SearchTrigger />
        </DialogTrigger>
        <DialogPortal container={container ?? searchTriggerRef.current}>
          <DialogPrimitive.Content className="top-full absolute left-0 bg-bg-primary -translate-y-full z-[8999] w-full">
            <DialogOverlay />
            <SearchField
              onSelect={(path) => {
                navigate(path);
                setOpen(false);
              }}
              onDeactivate={() => setOpen(false)}
            />
          </DialogPrimitive.Content>
        </DialogPortal>
      </div>
    </Dialog>
  );
}

function SearchTrigger() {
  return (
    <div className="rounded-lg border border-border-primary shadow-sm overflow-visible cursor-text">
      <div className="flex items-center justify-center px-3">
        <SearchIcon className="w-4 h-4 mr-2 opacity-50 shrink-0" />
        <span
          className={cn(
            "flex h-11 w-full rounded-md py-3 text-sm",
            "text-fg-secondary cursor-text",
            "leading-[21px]",
          )}
        >
          Search content...
        </span>
      </div>
    </div>
  );
}

function SearchField({
  onSelect,
  onDeactivate,
}: {
  onSelect: (path: SourcePath | ModuleFilePath) => void;
  onDeactivate?: () => void;
}) {
  const val = useValSystem();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const hasQuery = query.trim() !== "";
  // Search is the one consumer that cannot be scoped — it indexes all content by
  // definition — so it loads every `.jsonValues()` entry. That happens on user
  // INTENT (the first non-empty query), never on mount: radix mounts this content
  // when the dialog opens, so a mount-effect trigger would load on open.
  const jsonEntriesLoad = useAllJsonValuesLoad(hasQuery);

  /**
   * How far the entry load has got, as one value an effect can depend on.
   *
   * This is what re-runs the query while content is still arriving, and it is the
   * whole reason a progress number is used as a dependency: a `.jsonValues()`
   * index grows as batches land, so a query answered at 20% has to be asked again
   * at 60% or the results are stuck on what existed when it was typed.
   */
  const loadProgress =
    jsonEntriesLoad.status === "loading"
      ? jsonEntriesLoad.percentage
      : jsonEntriesLoad.status;

  /**
   * Query the one search index in the worker realm.
   *
   * This used to build a SECOND index here: `useSearchWorker` spun up its own
   * worker and this component rebuilt the whole thing in a throttled effect
   * whenever `sources` changed — while `useAISearch` queried the store's index
   * over the same content. Two indexes of one project, and the local one was
   * rebuilt from a whole-project subscription on every edit anywhere.
   *
   * `system.search` indexes on demand and only for the modules the index owes a
   * pass for, so the QUERY pays instead of every keystroke in the Studio. There
   * is nothing to build here and nothing to tear down.
   */
  useEffect(() => {
    if (val === null || !hasQuery) {
      setResults([]);
      return;
    }
    let cancelled = false;
    void val.system
      .search(query, 10)
      .then((found) => {
        if (cancelled) {
          return;
        }
        // `no-index` means the project has nothing indexable at all — an empty
        // result is the honest answer, not an error. `system.search` builds the
        // index before it queries, so it is never "not built yet".
        setResults(found.status === "no-index" ? [] : found.results);
      })
      .catch(() => {
        if (!cancelled) {
          setResults([]);
        }
      });
    return () => {
      // The guard against an out-of-order answer: a slow query for "a" must not
      // overwrite the results for "abc".
      cancelled = true;
    };
  }, [val, query, hasQuery, loadProgress]);

  const handleSelect = useCallback(
    (path: SourcePath | ModuleFilePath) => {
      onSelect(path);
      setQuery("");
      onDeactivate?.();
    },
    [onSelect, onDeactivate],
  );

  /**
   * One row per NAV path: several hits can live under one thing the Studio shows.
   *
   * Resolved through `useGetNavPath` rather than from a whole-project
   * subscription — the reason this component no longer reads `useAllSources()`.
   */
  const getNavPath = useGetNavPath();
  const deduplicatedResults = useMemo(() => {
    const addedPaths = new Set<string>();
    const deduplicated: SearchResult[] = [];
    for (const result of results) {
      const navPath = getNavPath(result.path) || result.path;
      if (!addedPaths.has(navPath)) {
        deduplicated.push(result);
        addedPaths.add(navPath);
      }
    }
    return deduplicated;
  }, [results, getNavPath]);

  // Focus the input when the component mounts (when dialog opens)
  useEffect(() => {
    // Use a small delay to ensure the dialog is fully rendered
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative w-full overflow-visible">
      <Command
        key="search-command"
        className={cn(
          "rounded-lg border border-border-primary shadow-sm overflow-visible",
          {
            "border-b-0 rounded-b-none pb-[1px]": !!query.trim(),
          },
        )}
        shouldFilter={false}
      >
        <CommandInput
          ref={inputRef}
          placeholder="Search content..."
          value={query}
          onValueChange={setQuery}
        />
        {hasQuery && (
          <SearchResultsList
            results={deduplicatedResults}
            onSelect={handleSelect}
            indexing={jsonEntriesLoad}
          />
        )}
      </Command>
    </div>
  );
}
