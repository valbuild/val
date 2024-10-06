import { ModuleFilePath, SourcePath } from "@valbuild/core";
import FlexSearch from "flexsearch";
export { createSearchIndex } from "./createSearchIndex";

const debugPerf = false;
export function search(
  indices: Record<
    ModuleFilePath,
    { sourcePath: FlexSearch.Index; source: FlexSearch.Index }
  >,
  query: string,
) {
  if (debugPerf) {
    console.time("search: " + query);
  }
  const existingResults = new Set();
  const results: FlexSearch.Id[] = [];
  for (const moduleFilePathS of Object.keys(indices).sort()) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const { sourcePath } = indices[moduleFilePath];
    for (const res of sourcePath.search(query)) {
      if (existingResults.has(res)) {
        continue;
      }
      existingResults.add(res);
      results.push(res);
    }
  }
  for (const moduleFilePathS of Object.keys(indices).sort()) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const { source } = indices[moduleFilePath];
    for (const res of source.search(query)) {
      if (existingResults.has(res)) {
        continue;
      }
      existingResults.add(res);
      results.push(res);
    }
  }
  if (debugPerf) {
    console.timeEnd("search: " + query);
  }
  return results as SourcePath[];
}
