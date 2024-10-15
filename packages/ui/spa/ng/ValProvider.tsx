import React, { useCallback, useContext, useMemo } from "react";
import {
  AllRichTextOptions,
  FILE_REF_PROP,
  FileSource,
  ImageSource,
  Internal,
  Json,
  ModuleFilePath,
  ModuleFilePathSep,
  ModulePath,
  RichTextSource,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { ValClient } from "@valbuild/shared/internal";
import { UpdatingRemote, useValState } from "./useValState";
import { Remote } from "../utils/Remote";
import { isJsonArray } from "../utils/isJsonArray";

const ValContext = React.createContext<{
  search:
    | false
    | {
        type?: "error" | "change";
        sourcePath?: SourcePath;
        filter?: string;
      };
  setSearch: (
    search:
      | false
      | {
          type?: "error" | "change";
          sourcePath?: SourcePath;
          filter?: string;
        },
  ) => void;
  addPatch: (moduleFilePath: ModuleFilePath, patch: Patch) => void;
  schemas: Remote<Record<ModuleFilePath, SerializedSchema>>;
  sources: Record<ModuleFilePath, UpdatingRemote<Json>>;
}>({
  search: false,
  setSearch: () => {
    throw new Error("ValContext not provided");
  },
  addPatch: () => {
    throw new Error("ValContext not provided");
  },
  get schemas(): Remote<Record<ModuleFilePath, SerializedSchema>> {
    throw new Error("ValContext not provided");
  },
  get sources(): Record<ModuleFilePath, UpdatingRemote<Json>> {
    throw new Error("ValContext not provided");
  },
});

function ValProvider({
  children,
  valClient,
}: {
  children: React.ReactNode;
  valClient: ValClient;
}) {
  const { addPatch, schemas, sources } = useValState(valClient);

  return (
    <ValContext.Provider
      value={{ search: false, setSearch: () => {}, addPatch, schemas, sources }}
    >
      {children}
    </ValContext.Provider>
  );
}

type EnsureAllTypes<T extends Record<SerializedSchema["type"], unknown>> = T;
type TypeMapping = EnsureAllTypes<{
  array: SourcePath[];
  object: Record<string, SourcePath>;
  record: Record<string, SourcePath>;
  union: string | Record<string, SourcePath>;
  boolean: boolean;
  keyOf: string | number;
  number: number;
  string: string;
  date: string;
  file: { [FILE_REF_PROP]: string };
  image: { [FILE_REF_PROP]: string };
  literal: string;
  richtext: unknown[];
}>;

export function useSchemaAtPath(
  sourcePath: SourcePath,
  shallowSource:
    | UpdatingRemote<TypeMapping[SerializedSchema["type"]] | null>
    | { status: "not-found" },
): UpdatingRemote<SerializedSchema> | { status: "not-found " } {
  const { schemas, sources } = useContext(ValContext);
  const getMemoizedResolvedSchema = useCallback(():
    | UpdatingRemote<SerializedSchema>
    | { status: "not-found " } => {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(sourcePath);
    const moduleSources = sources[moduleFilePath];

    Internal.resolvePath(modulePath);
  }, [sourcePath, sources, schemas]);

  return useMemo(getMemoizedResolvedSchema, [
    // NOTE: we avoid using sources directly, and instead rely on shallowSource to avoid unecessary re-renders
    JSON.stringify(shallowSource),
    sourcePath,
    schemas,
  ]);
}

/**
 * Shallow sources are the source that is just enough to render each type of schema.
 *
 * For example, if the schema is an object, the shallow source will contain the keys of the object and the source paths to the values below.
 *
 * The general idea is to avoid re-rendering the entire source tree when a single value changes.
 */
export function useShallowSourceAtPath<
  SchemaType extends SerializedSchema["type"],
>(
  sourcePath: SourcePath,
  type: SchemaType,
):
  | UpdatingRemote<TypeMapping[SerializedSchema["type"]] | null>
  | { status: "not-found" } {
  const { sources } = useContext(ValContext);

  const source = useMemo(():
    | UpdatingRemote<TypeMapping[SerializedSchema["type"]] | null>
    | { status: "not-found" } => {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(sourcePath);
    const moduleSources = sources[moduleFilePath];
    if (
      moduleSources.status === "updating" ||
      moduleSources.status === "success"
    ) {
      const sourceAtSourcePath = getSourceAtSourcePath(
        modulePath,
        type,
        moduleSources.data,
      );
      if (sourceAtSourcePath.status === "success") {
        return {
          status: moduleSources.status,
          data: sourceAtSourcePath.data,
        };
      } else {
        return sourceAtSourcePath;
      }
    } else if (moduleSources.status === "error") {
      if (moduleSources.data) {
        const sourceAtSourcePath = getSourceAtSourcePath(
          modulePath,
          type,
          moduleSources.data,
        );
        if (sourceAtSourcePath.status === "success") {
          return {
            status: "error",
            errors: moduleSources.errors,
            data: sourceAtSourcePath.data,
          };
        } else {
          return {
            status: "error",
            errors: (typeof moduleSources.errors === "string"
              ? [moduleSources.errors]
              : moduleSources.errors
            ).concat(
              sourceAtSourcePath.status === "error"
                ? sourceAtSourcePath.errors
                : [],
            ),
          };
        }
      }
      return {
        status: "error",
        errors: moduleSources.errors,
      };
    } else {
      return moduleSources;
    }
  }, [sources, sourcePath, type]);
  return source;
}

function getSourceAtSourcePath<SchemaType extends SerializedSchema["type"]>(
  modulePath: ModulePath,
  type: SchemaType,
  sources: Json,
):
  | { status: "not-found" }
  | {
      status: "success";
      data: TypeMapping[SchemaType] | null;
    }
  | {
      status: "error";
      errors: string;
    } {
  let source = sources;
  for (const part of Internal.splitModulePath(modulePath)) {
    if (source === undefined) {
      return { status: "not-found" };
    }
    if (typeof source !== "object") {
      return {
        status: "error",
        errors: `Expected object at ${modulePath}, got ${JSON.stringify(source)}`,
      };
    }
    if (source === null) {
      return {
        status: "error",
        errors: `Expected object at ${modulePath}, got null`,
      };
    }
    if (isJsonArray(source)) {
      const index = Number(part);
      if (Number.isNaN(index)) {
        return {
          status: "error",
          errors: `Expected number at ${modulePath}, got ${part}`,
        };
      }
      source = source[index];
    } else {
      source = source[part];
    }
  }
  const mappedSource = mapSource(modulePath, type, source);
  return mappedSource;
}

function mapSource<SchemaType extends SerializedSchema["type"]>(
  modulePath: ModulePath,
  schemaType: SchemaType,
  source: Json,
):
  | {
      status: "success";
      data: TypeMapping[SchemaType] | null;
    }
  | {
      status: "error";
      errors: string;
    } {
  if (source === null) {
    return { status: "success", data: null };
  }
  const type: SerializedSchema["type"] = schemaType;
  if (type === "object" || type === "record") {
    if (typeof source !== "object") {
      return {
        status: "error",
        errors: `Expected object, got ${typeof source}`,
      };
    }
    if (isJsonArray(source)) {
      return {
        status: "error",
        errors: `Expected object, got array`,
      };
    }
    const data: TypeMapping["object" | "record"] = {};
    for (const key of Object.keys(source)) {
      data[key] = concatModulePath(modulePath, key);
    }
    return {
      status: "success",
      data: data as TypeMapping[SchemaType],
    };
  } else if (type === "array") {
    if (typeof source !== "object" || !isJsonArray(source)) {
      return {
        status: "error",
        errors: `Expected array, got ${typeof source}`,
      };
    }
    const data: TypeMapping["array"] = [];
    for (let i = 0; i < source.length; i++) {
      data.push(concatModulePath(modulePath, i));
    }
    return {
      status: "success",
      data: data as TypeMapping[SchemaType],
    };
  } else if (type === "boolean") {
    if (typeof source !== "boolean") {
      return {
        status: "error",
        errors: `Expected boolean, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as TypeMapping[SchemaType],
    };
  } else if (type === "number") {
    if (typeof source !== "number") {
      return {
        status: "error",
        errors: `Expected number, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as TypeMapping[SchemaType],
    };
  } else if (type === "richtext") {
    if (typeof source !== "object" || !isJsonArray(source)) {
      return {
        status: "error",
        errors: `Expected array, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as TypeMapping[SchemaType],
    };
  } else if (type === "date" || type === "string" || type === "literal") {
    if (typeof source !== "string") {
      return {
        status: "error",
        errors: `Expected string, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as TypeMapping[SchemaType],
    };
  } else if (type === "file" || type === "image") {
    if (
      typeof source !== "object" ||
      !(FILE_REF_PROP in source) ||
      source[FILE_REF_PROP] === undefined
    ) {
      return {
        status: "error",
        errors: `Expected object with ${FILE_REF_PROP} property, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as TypeMapping[SchemaType],
    };
  } else if (type === "keyOf") {
    if (typeof source !== "string" && typeof source !== "number") {
      return {
        status: "error",
        errors: `Expected string or number, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as TypeMapping[SchemaType],
    };
  } else if (type === "union") {
    if (typeof source === "string") {
      return {
        status: "success",
        data: source as TypeMapping[SchemaType],
      };
    }
    if (typeof source !== "object") {
      return {
        status: "error",
        errors: `Expected object, got ${typeof source}`,
      };
    }
    if (isJsonArray(source)) {
      return {
        status: "error",
        errors: `Expected object, got array`,
      };
    }
    const data: TypeMapping["union"] = {};
    for (const key of Object.keys(source)) {
      data[key] = concatModulePath(modulePath, key);
    }
    return {
      status: "success",
      data: data as TypeMapping[SchemaType],
    };
  } else {
    const exhaustiveCheck: never = type;
    return {
      status: "error",
      errors: `Unknown schema type: ${exhaustiveCheck}`,
    };
  }
}

function concatModulePath(
  modulePath: ModulePath,
  key: string | number,
): SourcePath {
  if (modulePath === "") {
    return (ModuleFilePathSep + key) as SourcePath;
  }
  return (modulePath + "." + JSON.stringify(key)) as SourcePath;
}
