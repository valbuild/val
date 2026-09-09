import {
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import FlexSearch from "flexsearch";
import { traverseSchemaSource, flattenRichText } from "./traverseSchemaSource";
import { getRefParts } from "./getFilenameFromRef";

/**
 * The search index and the labels to render for its hits.
 *
 * Kept as a plain module rather than living inside a worker so it can be tested:
 * a worker entry runs `self.onmessage` on import, which no test environment here
 * provides.
 *
 * In `@valbuild/shared` rather than the Studio because there are now two
 * realms searching the same content: the Studio's `SearchStore`, which keeps an
 * index alive in a worker and re-indexes a module at a time, and the MCP
 * `search_content` tool, which builds one per call and throws it away. What
 * counts as a document, and what a hit is labelled, must not differ between
 * them — an agent and an editor searching the same project should find the same
 * things.
 */
/**
 * The parts of FlexSearch's `Index` this module uses.
 *
 * Structural, rather than importing flexsearch's own `Index`, because
 * {@link SearchIndex} is EXPORTED — and a `.d.ts` that names `flexsearch` pulls
 * that package's `declare module "flexsearch"` into every consumer's TypeScript
 * program. Ambient module declarations are global to a program, so a consumer
 * with its own flexsearch at another version then checks its OWN calls against
 * the copy we dragged in, whichever of the two wins.
 *
 * That is not hypothetical: `@valbuild/shared` gained a flexsearch dependency
 * in 0.123.0 for `search_content`, and valbuild/web — which pins flexsearch
 * 0.7 and calls `new flexsearch.Document({ language: "en", … })` — stopped
 * building on 0.123.2, because 0.8's `DocumentOptions` has no `language`. Its
 * own resolved copy was still 0.7; only the types had been replaced.
 *
 * Three methods is all this module calls, and none of their signatures here is
 * a guess: `add` and `remove` are used in `indexModule`/`removeModule`, and
 * `search`'s result is only ever `.length`-ed, `.slice`-d and mapped over as
 * ids. `FlexSearch.Index` is still constructed with the real library in
 * {@link createSearchIndex} — a value import, which does not reach the `.d.ts`.
 */
type SearchableIndex = {
  add(id: string, content: string): void;
  remove(id: string): void;
  search(query: string, options: { limit: number }): (string | number)[];
};

export type SearchIndex = {
  index: SearchableIndex;
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
      schema.type === "code" ||
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
    // Handle file/image
    else if (schema.type === "file" || schema.type === "image") {
      if (
        source !== null &&
        typeof source === "object" &&
        "path" in source &&
        typeof source.path === "string"
      ) {
        // The label is the bare filename - the folder is shown separately in
        // the UI - but both are searchable.
        const { filename, folder } = getRefParts(source.path);
        const alt = "alt" in source ? source.alt : "";
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

/**
 * How many hits are counted before `total` stops being a count.
 *
 * FlexSearch stops as soon as it has the number of ids it was asked for, so a
 * `total` taken from a page-sized search is just the page size again — which
 * reads as "that is all there is" to anyone who did not write it. Counting is
 * asking for more ids than the page needs, so it costs an array of ids and no
 * more; this bound is where that stops being free, and `totalIsLowerBound` says
 * it was reached rather than letting the number quietly lie.
 */
const MAX_COUNTED_RESULTS = 10_000;

export type SearchResults = {
  results: Array<{ path: SourcePath; label: string }>;
  /** Matches for the query, not just on this page. */
  total: number;
  /** `total` hit {@link MAX_COUNTED_RESULTS}, so it means "at least this many". */
  totalIsLowerBound: boolean;
};

export function performSearch(
  searchIndex: SearchIndex | null,
  query: string,
  limit = 50,
  offset = 0,
): SearchResults {
  if (searchIndex === null || !query.trim()) {
    return { results: [], total: 0, totalIsLowerBound: false };
  }
  const { index, pathToLabel } = searchIndex;
  const counted = Math.max(offset + limit, MAX_COUNTED_RESULTS);
  const searchResults = index.search(query, { limit: counted });
  const total = searchResults.length;
  const paged = searchResults.slice(offset, offset + limit);
  return {
    results: paged.map((id) => ({
      path: id as SourcePath,
      label: pathToLabel.get(id as string) || (id as string),
    })),
    total,
    totalIsLowerBound: total >= counted,
  };
}
