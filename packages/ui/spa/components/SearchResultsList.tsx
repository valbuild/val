import {
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
  Json,
} from "@valbuild/core";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "./designSystem/command";
import { ScrollArea } from "./designSystem/scroll-area";
import { SearchItem } from "./SearchItem";
import { getNavPathFromAll } from "./getNavPath";
import { Internal } from "@valbuild/core";

export type SearchResult = {
  path: SourcePath;
  label: string;
};

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

export function SearchResultsList({
  pages,
  otherResults,
  results,
  sources,
  schemas,
  onSelect,
}: {
  pages: SearchResult[];
  otherResults: SearchResult[];
  results: SearchResult[];
  sources: Record<ModuleFilePath, Json>;
  schemas: Record<ModuleFilePath, SerializedSchema> | undefined;
  onSelect: (path: SourcePath | ModuleFilePath) => void;
}) {
  return (
    <CommandList className="absolute top-full left-0 right-0 h-[min(420px,100vh-56px)]">
      <ScrollArea className="h-[calc(min(420px,100vh-56px)-124px)] z-50 p-2 pb-0 bg-bg-primary border border-t-0 border-border-primary rounded-lg rounded-t-none shadow-lg ">
        {results.length === 0 && (
          <CommandEmpty className="py-6 text-center text-fg-tertiary">
            No results found.
          </CommandEmpty>
        )}
        {pages.length > 0 && (
          <CommandGroup heading="Pages" className="gap-1">
            {pages.map((result) => {
              const navPath =
                getNavPathFromAll(result.path, sources, schemas) || result.path;
              const url = getRouterPageUrl(navPath as SourcePath);
              return (
                <CommandItem
                  key={result.path}
                  onSelect={() => onSelect(navPath)}
                  className="rounded-md px-3 py-2.5 aria-selected:bg-bg-secondary hover:bg-bg-secondary transition-colors"
                >
                  <SearchItem path={navPath as SourcePath} url={url} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {otherResults.length > 0 && (
          <CommandGroup heading="Results" className="gap-1">
            {otherResults.map((result) => {
              const navPath =
                getNavPathFromAll(result.path, sources, schemas) || result.path;
              return (
                <CommandItem
                  key={result.path}
                  onSelect={() => onSelect(navPath)}
                  className="rounded-md px-3 py-2.5 aria-selected:bg-bg-secondary hover:bg-bg-secondary transition-colors"
                >
                  <SearchItem path={navPath as SourcePath} url={null} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </ScrollArea>
    </CommandList>
  );
}
