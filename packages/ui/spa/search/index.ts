import { SourcePath } from "@valbuild/core";
import { Index } from "flexsearch";
export { createSearchIndex } from "./createSearchIndex";

const debugPerf = false;
export function search(index: Index, query: string) {
  if (debugPerf) {
    console.time("search: " + query);
  }
  const results = index.search(query);
  if (debugPerf) {
    console.timeEnd("search: " + query);
  }
  return results as SourcePath[];
}
