import {
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useAllSources, useSchemas } from "./ValFieldProvider";
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
import { getNavPathFromAll } from "./getNavPath";
import { useSearchWorker } from "../search/useSearchWorker";

export function Search({ container }: { container?: HTMLElement }) {
  const sources = useAllSources();
  const schemasRes = useSchemas();
  const schemas = schemasRes.status === "success" ? schemasRes.data : undefined;

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
              sources={sources}
              schemas={schemas}
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
  sources,
  schemas,
  onSelect,
  onDeactivate,
}: {
  sources: Record<ModuleFilePath, Json>;
  schemas: Record<ModuleFilePath, SerializedSchema> | undefined;
  onSelect: (path: SourcePath | ModuleFilePath) => void;
  onDeactivate?: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { buildIndex, search, results: workerResults } = useSearchWorker();

  // Build index when sources/schemas change
  useEffect(() => {
    if (!schemas) return;

    const modules: Record<
      ModuleFilePath,
      { source: Json; schema: SerializedSchema }
    > = {};

    for (const moduleFilePath in schemas) {
      const schema = schemas[moduleFilePath as ModuleFilePath];
      const source = sources[moduleFilePath as ModuleFilePath];
      if (schema && source !== undefined) {
        modules[moduleFilePath as ModuleFilePath] = { source, schema };
      }
    }

    buildIndex(modules);
  }, [sources, schemas, buildIndex]);

  // Trigger search when query changes
  useEffect(() => {
    search(query, 10);
  }, [query, search]);

  const results = useMemo((): SearchResult[] => {
    return workerResults;
  }, [workerResults]);

  const handleSelect = useCallback(
    (path: SourcePath | ModuleFilePath) => {
      onSelect(path);
      setQuery("");
      onDeactivate?.();
    },
    [onSelect, onDeactivate],
  );

  // Deduplicate results based on navPath
  const deduplicatedResults = useMemo(() => {
    const addedPaths = new Set<string>();
    const deduplicated: SearchResult[] = [];

    for (const result of results) {
      const navPath =
        getNavPathFromAll(result.path, sources, schemas) || result.path;
      if (!addedPaths.has(navPath)) {
        deduplicated.push(result);
        addedPaths.add(navPath);
      }
    }

    return deduplicated;
  }, [results, sources, schemas]);

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
        {query.trim() && (
          <SearchResultsList
            results={deduplicatedResults}
            sources={sources}
            schemas={schemas}
            onSelect={handleSelect}
          />
        )}
      </Command>
    </div>
  );
}
