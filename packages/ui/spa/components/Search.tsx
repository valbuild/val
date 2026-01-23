import {
  FILE_REF_PROP,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import FlexSearch from "flexsearch";
import { useMemo, useState, useCallback, useEffect } from "react";
import { useAllSources, useSchemas } from "./ValFieldProvider";
import { useNavigation } from "./ValRouter";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./designSystem/command";
import {
  traverseSchemaSource,
  flattenRichText,
} from "../utils/traverseSchemaSource";
import { getNavPathFromAll } from "./getNavPath";
import { SearchItem } from "./SearchItem";
import { Internal } from "@valbuild/core";
import { Search as SearchIcon } from "lucide-react";

type SearchResult = {
  path: SourcePath;
  label: string;
};

export function Search() {
  const [isActive, setIsActive] = useState(false);

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
        setIsActive(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!isActive) {
    return <SearchTrigger onActivate={() => setIsActive(true)} />;
  }

  return <SearchActive onDeactivate={() => setIsActive(false)} />;
}

function SearchTrigger({ onActivate }: { onActivate: () => void }) {
  return (
    <div className="relative w-full overflow-visible">
      <div
        className="rounded-lg border border-border-primary shadow-sm overflow-visible cursor-text"
        onClick={onActivate}
        onFocus={onActivate}
        tabIndex={0}
      >
        <div className="flex items-center px-3 h-11">
          <SearchIcon className="w-4 h-4 mr-2 opacity-50 shrink-0" />
          <input
            className="flex h-full w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-fg-secondary cursor-text"
            placeholder="Search content..."
            readOnly
            onFocus={onActivate}
          />
        </div>
      </div>
    </div>
  );
}

function SearchActive({ onDeactivate }: { onDeactivate: () => void }) {
  const sources = useAllSources();
  const schemasRes = useSchemas();
  const { navigate } = useNavigation();

  const schemas = schemasRes.status === "success" ? schemasRes.data : undefined;

  const handleSelect = useCallback(
    (path: SourcePath | ModuleFilePath) => {
      navigate(path);
      onDeactivate();
    },
    [navigate, onDeactivate],
  );

  return (
    <SearchField
      sources={sources}
      schemas={schemas}
      onSelect={handleSelect}
      onDeactivate={onDeactivate}
    />
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
  const [isFocused, setIsFocused] = useState(false);
  const [index, setIndex] = useState<FlexSearch.Index | null>(null);
  const [pathToLabel, setPathToLabel] = useState<Map<string, string>>(
    new Map(),
  );

  // Only build index when search input is focused
  useEffect(() => {
    if (!isFocused || !schemas || index !== null) {
      return;
    }

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

    const result = buildIndex(modules);
    setIndex(result.index);
    setPathToLabel(result.pathToLabel);
  }, [isFocused, schemas, sources, index]);

  const results = useMemo((): SearchResult[] => {
    if (!index || !query.trim()) {
      return [];
    }
    const searchResults = index.search(query, { limit: 10 });
    return searchResults.map((id) => ({
      path: id as SourcePath,
      label: pathToLabel.get(id as string) || (id as string),
    }));
  }, [index, query, pathToLabel]);

  const handleSelect = useCallback(
    (path: SourcePath | ModuleFilePath) => {
      onSelect(path);
      setQuery("");
      onDeactivate?.();
    },
    [onSelect, onDeactivate],
  );

  // Handle Escape key to close search
  useEffect(() => {
    if (!onDeactivate) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDeactivate();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onDeactivate]);

  // Separate pages (router pages) from other results
  const { pages, otherResults } = useMemo(() => {
    const pagesList: SearchResult[] = [];
    const otherList: SearchResult[] = [];

    const addedPaths = new Set<string>();
    for (const result of results) {
      const navPath =
        getNavPathFromAll(result.path, sources, schemas) || result.path;
      if (addedPaths.has(navPath)) {
        continue;
      }
      if (navPath && isRouterPage(navPath as SourcePath, schemas)) {
        pagesList.push(result);
      } else {
        otherList.push(result);
      }
      addedPaths.add(navPath);
    }

    return { pages: pagesList, otherResults: otherList };
  }, [results, sources, schemas]);

  return (
    <div className="relative w-full overflow-visible">
      <Command
        className="rounded-lg border border-border-primary shadow-sm overflow-visible"
        shouldFilter={false}
      >
        <CommandInput
          placeholder="Search content..."
          value={query}
          onValueChange={setQuery}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          autoFocus
        />
        {query.trim() && (
          <CommandList className="absolute top-full left-0 right-0 mt-1 max-h-[400px] overflow-y-auto p-2 z-[100] bg-bg-primary border border-border-primary rounded-lg shadow-lg">
            {results.length === 0 && (
              <CommandEmpty className="py-6 text-center text-fg-tertiary">
                No results found.
              </CommandEmpty>
            )}
            {pages.length > 0 && (
              <CommandGroup heading="Pages" className="gap-1">
                {pages.map((result, index) => {
                  const navPath =
                    getNavPathFromAll(result.path, sources, schemas) ||
                    result.path;
                  const url = getRouterPageUrl(navPath as SourcePath);
                  return (
                    <CommandItem
                      key={result.path}
                      value={`page-${index}`}
                      onSelect={() => handleSelect(navPath)}
                      className="cursor-pointer rounded-md px-3 py-2.5 aria-selected:bg-bg-secondary hover:bg-bg-secondary transition-colors"
                    >
                      <SearchItem path={navPath as SourcePath} url={url} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {otherResults.length > 0 && (
              <CommandGroup heading="Results" className="gap-1">
                {otherResults.map((result, index) => {
                  const navPath =
                    getNavPathFromAll(result.path, sources, schemas) ||
                    result.path;
                  return (
                    <CommandItem
                      key={result.path}
                      value={`result-${index}`}
                      onSelect={() => handleSelect(navPath)}
                      className="cursor-pointer rounded-md px-3 py-2.5 aria-selected:bg-bg-secondary hover:bg-bg-secondary transition-colors"
                    >
                      <SearchItem path={navPath as SourcePath} url={null} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        )}
      </Command>
    </div>
  );
}

function isRouterPage(
  path: SourcePath,
  schemas: Record<ModuleFilePath, SerializedSchema> | undefined,
): boolean {
  if (!schemas) return false;
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  if (!modulePath) return false;

  // Get parent path by removing last segment
  const pathSegments = Internal.splitModulePath(modulePath);
  if (pathSegments.length === 0) return false;

  // For nested paths, check if parent is a router
  // The parent would be the module with one less segment
  const moduleSchema = schemas[moduleFilePath];
  if (
    moduleSchema?.type === "record" &&
    Boolean(moduleSchema.router) &&
    moduleSchema.router !== "external"
  ) {
    // If the module is a router and we have a path segment, it's a router page
    return true;
  }

  return false;
}

function getRouterPageUrl(path: SourcePath): string | null {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
  if (!modulePath) return null;

  // Get the first key (URL) from the module path
  const pathSegments = Internal.splitModulePath(modulePath);
  if (pathSegments.length === 0) return null;

  // The first segment is the URL key
  const urlKey = pathSegments[0];
  // Try to parse it (it might be JSON stringified)
  try {
    return JSON.parse(urlKey);
  } catch {
    return urlKey;
  }
}

function buildIndex(
  modules: Record<ModuleFilePath, { source: Json; schema: SerializedSchema }>,
): { index: FlexSearch.Index; pathToLabel: Map<string, string> } {
  console.log("building index");
  const index = new FlexSearch.Index({
    tokenize: "forward",
  });
  const pathToLabel = new Map<string, string>();

  for (const moduleFilePathS in modules) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const { source, schema } = modules[moduleFilePath];
    const path = (moduleFilePath + "?p=") as SourcePath;

    traverseSchemaSource(source, schema, path, ({ source, schema, path }) => {
      if (source === null) {
        return;
      }

      let searchText = "";
      let label = "";

      // Handle primitives
      if (
        schema.type === "string" ||
        schema.type === "number" ||
        schema.type === "boolean"
      ) {
        searchText = source.toString();
        label = source.toString();
      }
      // Handle richtext - flatten to get text content
      else if (schema.type === "richtext") {
        searchText = flattenRichText(source);
        // Use first 50 chars as label
        label = searchText.substring(0, 50) || "richtext";
      }
      // Handle file/image - extract filename from _ref
      else if (schema.type === "file" || schema.type === "image") {
        if (
          source !== null &&
          typeof source === "object" &&
          FILE_REF_PROP in source &&
          typeof source[FILE_REF_PROP] === "string"
        ) {
          const filename = source[FILE_REF_PROP] as string;
          // Extract just the filename from the path
          const filenameOnly = filename.replace("/public/val/", "");
          const metadata = source?.metadata;
          const alt =
            metadata && typeof metadata === "object" && "alt" in metadata
              ? metadata.alt
              : "";
          searchText = filenameOnly + " " + alt;
          label = filenameOnly;
        }
      }
      // Handle date
      else if (schema.type === "date") {
        if (typeof source === "string") {
          searchText = source;
          label = source;
        }
      }
      // Handle keyOf
      else if (schema.type === "keyOf") {
        if (typeof source === "string" || typeof source === "number") {
          searchText = source.toString();
          label = source.toString();
        }
      }
      // Handle literal
      else if (schema.type === "literal") {
        searchText = schema.value.toString();
        label = schema.value.toString();
      }
      // Handle route
      else if (schema.type === "route") {
        if (typeof source === "string") {
          searchText = source;
          label = source;
        }
      }

      // Add to index if we have search text
      if (searchText) {
        index.add(path, searchText + " " + path);
        pathToLabel.set(path, label);
      }
    });
  }

  return { index, pathToLabel };
}
