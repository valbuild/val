import {
  FILE_REF_PROP,
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import FlexSearch, { Index } from "flexsearch";
import {
  traverseSchemaSource,
  flattenRichText,
} from "../utils/traverseSchemaSource";
import { getRefParts } from "../utils/getFilenameFromRef";

/**
 * The search index and the labels to render for its hits.
 *
 * Kept out of `search.worker.ts` so it can be tested: the worker module runs
 * `self.onmessage` on import, which no test environment here provides.
 */
export type SearchIndex = {
  index: Index;
  pathToLabel: Map<string, string>;
  /**
   * Which document ids belong to which module, so one module can be re-indexed
   * without touching the others.
   *
   * The ids are the `SourcePath`s themselves — `index.add(path, …)` below — so
   * this could be recovered by scanning `pathToLabel` for a module-file-path
   * prefix. It is kept explicitly anyway: the scan would be O(every document in
   * the project) per module re-indexed, which is the whole-project cost that
   * re-indexing one module exists to avoid.
   */
  docsByModule: Map<ModuleFilePath, Set<string>>;
};

/** An index with nothing in it. Fill it with {@link indexModule}. */
export function createSearchIndex(): SearchIndex {
  return {
    index: new FlexSearch.Index({ tokenize: "forward" }),
    pathToLabel: new Map(),
    docsByModule: new Map(),
  };
}

/**
 * Index one module, replacing whatever was previously indexed for it.
 *
 * Remove-then-add rather than `update`, because the set of paths in a module is
 * not stable: deleting an array item or a record entry means documents that must
 * disappear, and `update` only revises ids it is given.
 *
 * `.jsonValues()` entries are indexed only once their content is loaded — an
 * un-loaded entry is an opaque marker that {@link traverseSchemaSource} skips, so
 * the index is naturally PARTIAL and grows as batches land. That is why the search
 * UI loads the entries on the first query and re-indexes (debounced) as they
 * arrive, rather than pretending an empty result set is an answer.
 */
export function indexModule(
  searchIndex: SearchIndex,
  moduleFilePath: ModuleFilePath,
  source: Json,
  schema: SerializedSchema,
): void {
  const { index, pathToLabel, docsByModule } = searchIndex;
  removeModule(searchIndex, moduleFilePath);
  const docs = new Set<string>();
  docsByModule.set(moduleFilePath, docs);
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
      schema.type === "boolean" ||
      schema.type === "date" ||
      schema.type === "dateTime" ||
      schema.type === "color" ||
      schema.type === "keyOf" ||
      schema.type === "route"
    ) {
      searchText = source?.toString() ?? "";
      label = source?.toString() ?? "";
    } else if (schema.type === "literal") {
      searchText = schema.value.toString();
      label = schema.value.toString();
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
        const ref = source[FILE_REF_PROP] as string;
        // The label is the bare filename - the folder is shown separately in
        // the UI - but both are searchable.
        const { filename, folder } = getRefParts(ref);
        const metadata = source?.metadata;
        const alt =
          metadata && typeof metadata === "object" && "alt" in metadata
            ? metadata.alt
            : "";
        searchText = filename + " " + folder + " " + alt;
        label = filename;
      }
    }

    // Add to index if we have search text
    if (searchText) {
      const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
      const cleanPath = fastRemoveNonWordChars(modulePath) + " ";
      index.add(path, cleanPath + " " + path + " " + searchText);
      pathToLabel.set(path, label);
      docs.add(path);
    }
  });
}

/**
 * Drop everything indexed for one module.
 *
 * Also used for a module that has gone away entirely — otherwise its documents
 * stay searchable and a hit navigates to a path that no longer exists.
 */
export function removeModule(
  searchIndex: SearchIndex,
  moduleFilePath: ModuleFilePath,
): void {
  const { index, pathToLabel, docsByModule } = searchIndex;
  const existing = docsByModule.get(moduleFilePath);
  if (existing === undefined) return;
  for (const id of existing) {
    index.remove(id);
    pathToLabel.delete(id);
  }
  docsByModule.delete(moduleFilePath);
}

/**
 * Index every module, from scratch.
 *
 * Now a loop over {@link indexModule} rather than its own walk, so the full
 * build and the incremental one cannot drift in what they consider a document.
 */
export function buildSearchIndex(
  modules: Record<ModuleFilePath, { source: Json; schema: SerializedSchema }>,
): SearchIndex {
  const searchIndex = createSearchIndex();
  for (const moduleFilePathS in modules) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const { source, schema } = modules[moduleFilePath];
    indexModule(searchIndex, moduleFilePath, source, schema);
  }
  return searchIndex;
}

const NON_CHARS = new Set([
  "/",
  "-",
  "_",
  ".",
  ":",
  "?",
  "&",
  "=",
  "@",
  '"',
  "'",
]);
function fastRemoveNonWordChars(str: string): string {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (!NON_CHARS.has(char)) {
      result += char;
    } else {
      result += " ";
    }
  }
  return result;
}

export function performSearch(
  searchIndex: SearchIndex | null,
  query: string,
  limit = 50,
  offset = 0,
): { results: Array<{ path: SourcePath; label: string }>; total: number } {
  if (searchIndex === null || !query.trim()) {
    return { results: [], total: 0 };
  }
  const { index, pathToLabel } = searchIndex;
  const searchResults = index.search(query, { limit: offset + limit });
  const total = searchResults.length;
  const paged = searchResults.slice(offset, offset + limit);
  return {
    results: paged.map((id) => ({
      path: id as SourcePath,
      label: pathToLabel.get(id as string) || (id as string),
    })),
    total,
  };
}
