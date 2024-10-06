import { SourcePath } from "@valbuild/core";
import FlexSearch from "flexsearch";
export { createSearchIndex } from "./createSearchIndex";

const debugPerf = false;
export function search(index: FlexSearch.Index, query: string) {
  if (debugPerf) {
    console.time("search: " + query);
  }
  const results = index.search(query);
  if (debugPerf) {
    console.timeEnd("search: " + query);
  }
  return results as SourcePath[];
}
