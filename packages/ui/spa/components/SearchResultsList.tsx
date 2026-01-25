import {
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
  Json,
} from "@valbuild/core";
import { CommandEmpty, CommandItem, CommandList } from "./designSystem/command";
import { ScrollArea } from "./designSystem/scroll-area";
import { SearchItem } from "./SearchItem";
import { getNavPathFromAll } from "./getNavPath";
import { Fragment } from "react";

export type SearchResult = {
  path: SourcePath;
  label: string;
};

export function SearchResultsList({
  results,
  sources,
  schemas,
  onSelect,
}: {
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
        {results.map((result) => {
          const navPath =
            getNavPathFromAll(result.path, sources, schemas) || result.path;
          return (
            <Fragment key={result.path}>
              <div className="h-px bg-border-primary opacity-50" />
              <CommandItem
                onSelect={() => onSelect(navPath)}
                className="flex flex-col justify-between px-3 py-2.5 aria-selected:bg-bg-secondary hover:bg-bg-secondary transition-colors"
              >
                <SearchItem path={navPath as SourcePath} size="compact" />
              </CommandItem>
            </Fragment>
          );
        })}
      </ScrollArea>
    </CommandList>
  );
}
