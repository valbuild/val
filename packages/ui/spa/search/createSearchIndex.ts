import {
  FILE_REF_PROP,
  Internal,
  Json,
  ModuleFilePath,
  ModulePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import FlexSearch from "flexsearch";
import { isJsonArray } from "../utils/isJsonArray";

function rec(
  source: Json,
  schema: SerializedSchema,
  path: SourcePath,
  sourceIndex: FlexSearch.Index,
  sourcePathIndex: FlexSearch.Index,
): void {
  const isRoot = path.endsWith("?p="); // skip root module
  if (
    !isRoot // skip root module
  ) {
    addTokenizedSourcePath(sourcePathIndex, path);
  }
  if (!schema?.type) {
    throw new Error("Schema not found for " + path);
  } else if (source === null) {
    return;
  }
  if (schema.type === "richtext") {
    sourceIndex.add(path, stringifyRichText(source) + " " + path);
  } else if (schema.type === "array") {
    if (!Array.isArray(source)) {
      throw new Error(
        "Expected array, got " + typeof source + " for " + path + ": " + source,
      );
    } else {
      for (let i = 0; i < source.length; i++) {
        const subPath = path + (isRoot ? "" : ".") + i;
        if (!schema?.item) {
          throw new Error(
            "Schema (" + schema.type + ") item not found for " + subPath,
          );
        } else {
          rec(
            source[i],
            schema?.item,
            subPath as SourcePath,
            sourceIndex,
            sourcePathIndex,
          );
        }
      }
    }
  } else if (schema.type === "object" || schema.type === "record") {
    if (typeof source !== "object") {
      throw new Error(
        "Expected object, got " +
          typeof source +
          " for " +
          path +
          ": " +
          source,
      );
    } else {
      for (const key in source) {
        const subSchema =
          schema.type === "object" ? schema?.items?.[key] : schema?.item;
        const subPath = (path +
          (isRoot ? "" : ".") +
          JSON.stringify(key)) as SourcePath;

        if (!subSchema) {
          throw new Error(
            "Object schema  (" +
              schema.type +
              ") item(s) not found for " +
              subPath,
          );
        } else if (source && typeof source === "object") {
          if (isJsonArray(source)) {
            throw new Error(
              `Object schema does not have source of correct type: array, key: ${key} for ${path}`,
            );
          } else if (!(key in source)) {
            throw new Error(
              `Object schema does is missing required key: ${key} in ${path}`,
            );
          } else {
            rec(source[key], subSchema, subPath, sourceIndex, sourcePathIndex);
          }
        } else {
          throw new Error(
            `Object schema does not have source of correct type: ${typeof source}, key: ${key} for ${path}`,
          );
        }
      }
    }
  } else if (schema.type === "union") {
    if (typeof schema.key === "string") {
      const schemaKey = schema.key;
      const subSchema = (schema.items as SerializedSchema[]).find((item) => {
        if (item.type !== "object") {
          throw new Error(
            `Union schema must have sub object of object but has: (${item.type}) for ${path}`,
          );
        } else {
          const schemaAtKey = item.items[schemaKey];
          if (schemaAtKey.type !== "literal") {
            throw new Error(
              `Union schema must have sub object with literal key but has: ${
                (item.items as Record<string, SerializedSchema>)?.[schemaKey]
                  ?.type
              } for ${path}`,
            );
          } else if (
            source &&
            typeof source === "object" &&
            !isJsonArray(source) &&
            schemaKey in source
          ) {
            return schemaAtKey.value === source[schemaKey];
          } else {
            throw new Error(
              `Union schema must have sub object with literal key but has: ${item.items[schemaKey]} for ${path}`,
            );
          }
        }
      });
      if (!subSchema) {
        throw new Error(
          "Union schema  (" + schema.type + ") item(s) not found for " + path,
        );
      } else {
        rec(source, subSchema, path, sourceIndex, sourcePathIndex);
      }
    } else {
      if (typeof source !== "string") {
        throw new Error(
          "Expected string for union string, got " +
            typeof source +
            " for " +
            path +
            ": " +
            source,
        );
      } else {
        sourceIndex.add(path, source + " " + path);
      }
    }
  } else if (schema.type === "string") {
    if (typeof source === "string") {
      sourceIndex.add(path, source + " " + path);
    } else {
      throw new Error(
        "Expected string, got " +
          typeof source +
          " for " +
          path +
          ": " +
          source,
      );
    }
  } else if (schema.type === "date") {
    if (typeof source === "string") {
      sourceIndex.add(path, source + " " + path);
    } else {
      throw new Error(
        "Expected string for schema date, got " +
          typeof source +
          " for " +
          path +
          ": " +
          source,
      );
    }
  } else if (schema.type === "keyOf") {
    if (typeof source === "string") {
      sourceIndex.add(path, source + " " + path);
    } else if (typeof source === "number") {
      sourceIndex.add(path, source + " " + path);
    } else {
      throw new Error(
        "Expected string or number for schema keyOf, got " +
          typeof source +
          " for " +
          path +
          ": " +
          source,
      );
    }
  } else if (schema.type === "number") {
    if (typeof source === "number") {
      sourceIndex.add(path, source.toString() + " " + path);
    } else {
      throw new Error(
        "Expected number, got " +
          typeof source +
          " for " +
          path +
          ": " +
          source,
      );
    }
  } else if (schema.type === "literal") {
    sourceIndex.add(path, schema.value + " " + path);
  } else if (schema.type === "image" || schema.type === "file") {
    if (
      source &&
      typeof source === "object" &&
      FILE_REF_PROP in source &&
      typeof source[FILE_REF_PROP] === "string"
    ) {
      sourceIndex.add(path, source[FILE_REF_PROP] + " " + path);
    } else {
      throw new Error(
        "Expected object with file ref prop, got " +
          typeof source +
          " for " +
          path +
          ": " +
          source,
      );
    }
  } else if (schema.type === "boolean") {
    // ignore booleans
  } else if (schema.type === "route") {
    if (typeof source === "string") {
      sourceIndex.add(path, source + " " + path);
    }
  } else {
    const exhaustiveCheck: never = schema;
    throw new Error(
      "Unsupported schema type: " + JSON.stringify(exhaustiveCheck),
    );
  }
}

function stringifyRichText(source: Json): string {
  let res = "";
  function rec(child: Json): void {
    if (typeof child === "string") {
      res += child;
    } else {
      if (
        child &&
        typeof child === "object" &&
        "children" in child &&
        Array.isArray(child.children)
      ) {
        for (const c of child.children) {
          rec(c);
        }
      }
    }
  }
  rec({ children: source });
  return res;
}

function isUpperCase(char: string) {
  // Check if the character is a letter and if it's uppercase
  return char.toUpperCase() === char && char.toLowerCase() !== char;
}

function splitOnCase(str: string) {
  const result: string[] = [];
  let currentWord = "";

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (i !== 0 && isUpperCase(char)) {
      result.push(currentWord);
      currentWord = char;
    } else {
      currentWord += char;
    }
  }

  if (currentWord) {
    result.push(currentWord);
  }

  return result;
}

function tokenizeSourcePath(sourcePath: SourcePath | ModuleFilePath) {
  const tokens: string[] = [sourcePath]; // add full path
  const existingTokens = new Set();
  const moduleFilePathIndex = sourcePath.indexOf("?p=");
  const moduleFilePath = sourcePath.slice(
    0,
    moduleFilePathIndex === -1 ? sourcePath.length : moduleFilePathIndex,
  ) as ModuleFilePath;
  const parts = moduleFilePath.split("/").slice(1); // skip first empty part
  const lastPart = sourcePath.slice(
    moduleFilePathIndex + 1,
    sourcePath.length + 1,
  );
  for (const part of parts) {
    if (existingTokens.has(part)) {
      continue;
    }
    existingTokens.add(part);
    tokens.push(part);
    for (const casePart of splitOnCase(part)) {
      if (existingTokens.has(casePart)) {
        continue;
      }
      existingTokens.add(casePart);
      tokens.push(casePart);
    }
  }
  const fileExtLength = 7; // length of .val.[tj]s
  if (
    !(moduleFilePath.endsWith(".val.ts") || moduleFilePath.endsWith(".val.js"))
  ) {
    throw new Error(
      "Unsupported file extension: " + moduleFilePath + " for " + sourcePath,
    );
  }
  const filenameWithoutExt = moduleFilePath.slice(0, -fileExtLength);
  tokens.push(...splitOnCase(filenameWithoutExt), filenameWithoutExt);

  const modulePath = lastPart as ModulePath;
  if (!modulePath) {
    return tokens;
  }
  for (const part of Internal.splitModulePath(modulePath as ModulePath)) {
    if (existingTokens.has(part)) {
      continue;
    }
    existingTokens.add(part);
    tokens.push(part);
    for (const casePart of splitOnCase(part)) {
      if (existingTokens.has(casePart)) {
        continue;
      }
      existingTokens.add(casePart);
      tokens.push(casePart);
    }
  }
  return tokens;
}

function addTokenizedSourcePath(
  sourcePathIndex: FlexSearch.Index,
  sourcePath: SourcePath | ModuleFilePath,
) {
  sourcePathIndex.add(sourcePath, tokenizeSourcePath(sourcePath).join(" "));
}
const debugPerf = true;
export function createSearchIndex(
  modules: Record<ModuleFilePath, { source: Json; schema: SerializedSchema }>,
): FlexSearch.Index {
  if (debugPerf) {
    console.time("indexing");
  }
  const index = new FlexSearch.Index();
  for (const moduleFilePathS in modules) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;

    const { source, schema } = modules[moduleFilePath];
    addTokenizedSourcePath(index, moduleFilePath);

    rec(source, schema, (moduleFilePathS + "?p=") as SourcePath, index, index);
  }
  if (debugPerf) {
    console.timeEnd("indexing");
  }
  return index;
}
