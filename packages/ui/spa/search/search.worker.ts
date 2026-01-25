import {
  FILE_REF_PROP,
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
import type { WorkerRequest, WorkerResponse } from "./worker-types";

let index: Index | null = null;
let pathToLabel: Map<string, string> = new Map();

function buildIndex(
  modules: Record<ModuleFilePath, { source: Json; schema: SerializedSchema }>,
): { index: Index; pathToLabel: Map<string, string> } {
  const newIndex = new FlexSearch.Index({
    tokenize: "forward",
  });
  const newPathToLabel = new Map<string, string>();

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
        schema.type === "keyOf" ||
        schema.type === "route"
      ) {
        searchText = source.toString();
        label = source.toString();
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
          const filenameOnly = filename.replace("/public/val/", "");
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
        newIndex.add(path, searchText + " " + path);
        newPathToLabel.set(path, label);
      }
    });
  }

  return { index: newIndex, pathToLabel: newPathToLabel };
}

function performSearch(
  query: string,
  limit = 10,
): Array<{ path: SourcePath; label: string }> {
  if (!index || !query.trim()) {
    return [];
  }

  const searchResults = index.search(query, { limit });
  return searchResults.map((id) => ({
    path: id as SourcePath,
    label: pathToLabel.get(id as string) || (id as string),
  }));
}

// Handle messages from main thread
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    if (request.type === "build-index") {
      const result = buildIndex(request.modules);
      index = result.index;
      pathToLabel = result.pathToLabel;

      // Send back the pathToLabel map as an array for serialization
      const response: WorkerResponse = {
        type: "index-ready",
        id: request.id,
        pathToLabel: Array.from(pathToLabel.entries()),
      };
      self.postMessage(response);
    } else if (request.type === "search") {
      const results = performSearch(request.query, request.limit);

      const response: WorkerResponse = {
        type: "search-results",
        id: request.id,
        results,
      };
      self.postMessage(response);
    }
  } catch (error) {
    const response: WorkerResponse = {
      type: "error",
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
