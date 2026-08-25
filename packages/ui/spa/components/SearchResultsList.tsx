import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { CommandEmpty, CommandItem, CommandList } from "./designSystem/command";
import { ScrollArea } from "./designSystem/scroll-area";
import { SearchItem } from "./SearchItem";
import { useGetNavPath } from "./ValFieldProvider";
import { Fragment } from "react";
import { JsonValuesLoadStatus } from "./useJsonValuesLoad";

export type SearchResult = {
  path: SourcePath;
  label: string;
};

export function SearchResultsList({
  results,
  onSelect,
  indexing,
}: {
  results: SearchResult[];
  onSelect: (path: SourcePath | ModuleFilePath) => void;
  /**
   * Whether content that is not in the index yet is still being loaded
   * (`.jsonValues()` entries). Results are shown as they are found rather than
   * waiting for this, so the user needs to be told the set is still filling —
   * and, if it failed, that what they see may be incomplete.
   */
  indexing?: JsonValuesLoadStatus;
}) {
  /**
   * Resolved here rather than taken as a prop pair.
   *
   * A hit's path is where the value LIVES; the nav path is where the Studio can
   * show it, and deriving one from the other needs every module's source and
   * schema. Taking those as props made both callers subscribe to the whole
   * project for data only this loop reads. `useGetNavPath` is the on-demand read
   * that exists for exactly this — see its comment on why a whole-project
   * subscription inside a component that renders per row is the wrong shape.
   */
  const getNavPath = useGetNavPath();
  const stillIndexing = indexing?.status === "loading";
  return (
    <CommandList className="absolute top-full left-0 right-0 h-[min(420px,100vh-56px)]">
      <ScrollArea className="h-[calc(min(420px,100vh-56px)-124px)] z-50 p-2 pb-0 bg-bg-primary border border-t-0 border-border-primary rounded-lg rounded-t-none shadow-lg ">
        {indexing?.status === "loading" && (
          <div className="px-3 py-2 text-xs text-fg-tertiary">
            Searching… {indexing.percentage}% indexed
          </div>
        )}
        {indexing?.status === "error" && (
          <div className="px-3 py-2 text-xs text-fg-tertiary">
            Some content could not be loaded, so these results may be
            incomplete.
          </div>
        )}
        {/* "No results" would be a lie while the index is still filling. */}
        {results.length === 0 && !stillIndexing && (
          <CommandEmpty className="py-6 text-center text-fg-tertiary">
            No results found.
          </CommandEmpty>
        )}
        {results.map((result) => {
          const navPath = getNavPath(result.path) || result.path;
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
