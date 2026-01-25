import {
  FILE_REF_PROP,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import FlexSearch, { Index } from "flexsearch";
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
import {
  traverseSchemaSource,
  flattenRichText,
} from "../utils/traverseSchemaSource";
import { Internal } from "@valbuild/core";
import { Search as SearchIcon } from "lucide-react";
import { cn } from "./designSystem/cn";
import { SearchResultsList, type SearchResult } from "./SearchResultsList";
import { getNavPathFromAll } from "./getNavPath";

export function Search() {
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
        <DialogPortal container={searchTriggerRef.current}>
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
  const indexRes = useMemo(() => {
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
    return result;
  }, [sources, schemas]);
  const index = useMemo(() => {
    return indexRes?.index ?? null;
  }, [indexRes]);
  const pathToLabel = useMemo(() => {
    return indexRes?.pathToLabel ?? new Map();
  }, [indexRes]);

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
            pages={pages}
            otherResults={otherResults}
            results={results}
            sources={sources}
            schemas={schemas}
            onSelect={handleSelect}
          />
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

function buildIndex(
  modules: Record<ModuleFilePath, { source: Json; schema: SerializedSchema }>,
): { index: Index; pathToLabel: Map<string, string> } {
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
