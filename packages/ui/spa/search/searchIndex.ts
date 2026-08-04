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

/**
 * The search index and the labels to render for its hits.
 *
 * Kept out of `search.worker.ts` so it can be tested: the worker module runs
 * `self.onmessage` on import, which no test environment here provides.
 */
export type SearchIndex = {
  index: Index;
  pathToLabel: Map<string, string>;
};

/**
 * Indexes every leaf value of every module.
 *
 * `.jsonValues()` entries are indexed only once their content is loaded — an
 * un-loaded entry is an opaque marker that {@link traverseSchemaSource} skips, so
 * the index is naturally PARTIAL and grows as batches land. That is why the search
 * UI loads the entries on the first query and re-indexes (debounced) as they
 * arrive, rather than pretending an empty result set is an answer.
 */
export function buildSearchIndex(
  modules: Record<ModuleFilePath, { source: Json; schema: SerializedSchema }>,
): SearchIndex {
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
        schema.type === "boolean" ||
        schema.type === "date" ||
        schema.type === "dateTime" ||
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
          const filename = source[FILE_REF_PROP] as string;
          // Extract just the filename from the path
          const filenameOnly = filename.replace("/public", "");
          const metadata = source?.metadata;
          const alt =
            metadata && typeof metadata === "object" && "alt" in metadata
              ? metadata.alt
              : "";
          searchText = filenameOnly + " " + alt;
          label = filenameOnly;
        }
      }

      // Add to index if we have search text
      if (searchText) {
        const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
        const cleanPath = fastRemoveNonWordChars(modulePath) + " ";
        index.add(path, cleanPath + " " + path + " " + searchText);
        pathToLabel.set(path, label);
      }
    });
  }

  return { index, pathToLabel };
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
