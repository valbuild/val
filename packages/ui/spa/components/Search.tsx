import {
  FILE_REF_PROP,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import FlexSearch from "flexsearch";
import { useMemo, useState, useCallback } from "react";
import { useAllSources, useSchemas } from "./ValProvider";
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
import { Internal, ModulePath } from "@valbuild/core";
import { Globe } from "lucide-react";

type SearchResult = {
  path: SourcePath;
  label: string;
};

export function Search() {
  const [query, setQuery] = useState("");
  const sources = useAllSources();
  const schemasRes = useSchemas();
  const { navigate } = useNavigation();

  const { index, pathToLabel } = useMemo(() => {
    if (schemasRes.status !== "success") {
      return { index: null, pathToLabel: new Map<string, string>() };
    }
    const schemas = schemasRes.data;
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

    return buildIndex(modules);
  }, [sources, schemasRes]);

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
      navigate(path);
      setQuery("");
    },
    [navigate],
  );

  const schemas = schemasRes.status === "success" ? schemasRes.data : undefined;

  // Separate pages (router pages) from other results
  const { pages, otherResults } = useMemo(() => {
    const pagesList: SearchResult[] = [];
    const otherList: SearchResult[] = [];

    for (const result of results) {
      const navPath =
        getNavPathFromAll(result.path, sources, schemas) || result.path;
      if (navPath && isRouterPage(navPath as SourcePath, schemas)) {
        pagesList.push(result);
      } else {
        otherList.push(result);
      }
    }

    return { pages: pagesList, otherResults: otherList };
  }, [results, sources, schemas]);

  return (
    <Command
      className="rounded-lg border border-border-primary shadow-sm"
      shouldFilter={false}
    >
      <CommandInput
        placeholder="Search content..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[400px] overflow-y-auto p-2">
        {query.trim() && results.length === 0 && (
          <CommandEmpty className="py-6 text-center text-fg-tertiary">
            No results found.
          </CommandEmpty>
        )}
        {pages.length > 0 && (
          <CommandGroup heading="Pages" className="gap-1">
            {pages.map((result, index) => {
              const navPath =
                getNavPathFromAll(result.path, sources, schemas) || result.path;
              const url = getRouterPageUrl(navPath as SourcePath);
              return (
                <CommandItem
                  key={result.path}
                  value={`page-${index}`}
                  onSelect={() => handleSelect(navPath)}
                  className="cursor-pointer rounded-md px-3 py-2.5 aria-selected:bg-bg-secondary hover:bg-bg-secondary transition-colors"
                >
                  <div className="flex items-center gap-2 w-full">
                    <Globe className="h-4 w-4 text-fg-tertiary shrink-0" />
                    <div className="flex-1 min-w-0">
                      {url && (
                        <div className="text-sm font-mono text-fg-secondary mb-1">
                          {url}
                        </div>
                      )}
                      <SearchItem path={navPath as SourcePath} />
                    </div>
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {otherResults.length > 0 && (
          <CommandGroup heading="Results" className="gap-1">
            {otherResults.map((result, index) => {
              const navPath =
                getNavPathFromAll(result.path, sources, schemas) || result.path;
              return (
                <CommandItem
                  key={result.path}
                  value={`result-${index}`}
                  onSelect={() => handleSelect(navPath)}
                  className="cursor-pointer rounded-md px-3 py-2.5 aria-selected:bg-bg-secondary hover:bg-bg-secondary transition-colors"
                >
                  <SearchItem path={navPath as SourcePath} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
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

  // If there's only one segment, check if the module itself is a router
  if (pathSegments.length === 1) {
    const moduleSchema = schemas[moduleFilePath];
    return moduleSchema?.type === "record" && Boolean(moduleSchema.router);
  }

  // For nested paths, check if parent is a router
  // The parent would be the module with one less segment
  const moduleSchema = schemas[moduleFilePath];
  if (moduleSchema?.type === "record" && Boolean(moduleSchema.router)) {
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
          const filenameOnly = filename.split("/").pop() || filename;
          searchText = filenameOnly;
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
        index.add(path, searchText);
        pathToLabel.set(path, label);
      }
    });
  }

  return { index, pathToLabel };
}
