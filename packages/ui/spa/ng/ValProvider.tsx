import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FILE_REF_PROP,
  Internal,
  Json,
  ModuleFilePath,
  ModuleFilePathSep,
  ModulePath,
  PatchId,
  SerializedSchema,
  SourcePath,
  ValConfig,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { ValClient } from "@valbuild/shared/internal";
import { Remote } from "../utils/Remote";
import { isJsonArray } from "../utils/isJsonArray";
import { DayPickerProvider } from "react-day-picker";
import { useValState } from "./useValState";

const ValContext = React.createContext<{
  theme: Themes | null;
  setTheme: (theme: Themes | null) => void;
  config: ValConfig | undefined;
  addPatch: (moduleFilePath: ModuleFilePath, patch: Patch) => void;
  getPatches: (patchIds: PatchId[]) => Promise<GetPatchRes>;
  addDebouncedPatch: (get: () => Patch, path: SourcePath) => void;
  publish: () => void;
  isPublishing: boolean;
  publishError: string | null;
  schemas: Remote<Record<ModuleFilePath, SerializedSchema>>;
  schemaSha: string | undefined;
  sources: Record<ModuleFilePath, Json | undefined>;
  sourcesSyncStatus: Record<
    ModuleFilePath,
    | {
        status: "loading";
      }
    | {
        status: "error";
        errors: string[];
      }
  >;
  patchesStatus: Record<
    SourcePath,
    | {
        status: "created-patch";
        createdAt: string;
      }
    | {
        status: "uploading-patch";
        createdAt: string;
        updatedAt: string;
      }
    | {
        status: "error";
        errors: string[];
      }
  >;
  patchIds: PatchId[];
}>({
  get theme(): Themes | null {
    throw new Error("ValContext not provided");
  },
  get setTheme(): React.Dispatch<React.SetStateAction<Themes | null>> {
    throw new Error("ValContext not provided");
  },
  get config(): ValConfig | undefined {
    throw new Error("ValContext not provided");
  },
  get addPatch(): () => void {
    throw new Error("ValContext not provided");
  },
  get getPatches(): () => Promise<GetPatchRes> {
    throw new Error("ValContext not provided");
  },
  get addDebouncedPatch(): () => void {
    throw new Error("ValContext not provided");
  },
  get publish(): () => void {
    throw new Error("ValContext not provided");
  },
  get isPublishing(): boolean {
    throw new Error("ValContext not provided");
  },
  get publishError(): string | null {
    throw new Error("ValContext not provided");
  },
  get schemas(): Remote<Record<ModuleFilePath, SerializedSchema>> {
    throw new Error("ValContext not provided");
  },
  get schemaSha(): string | undefined {
    throw new Error("ValContext not provided");
  },
  get sources(): Record<ModuleFilePath, Json | undefined> {
    throw new Error("ValContext not provided");
  },
  get sourcesSyncStatus(): Record<
    ModuleFilePath,
    | {
        status: "loading";
      }
    | {
        status: "error";
        errors: string[];
      }
  > {
    throw new Error("ValContext not provided");
  },
  get patchesStatus(): Record<
    SourcePath,
    | {
        status: "created-patch";
        createdAt: string;
      }
    | {
        status: "uploading-patch";
        createdAt: string;
        updatedAt: string;
      }
    | {
        status: "error";
        errors: string[];
      }
  > {
    throw new Error("ValContext not provided");
  },
  get patchIds(): PatchId[] {
    throw new Error("ValContext not provided");
  },
});

export function ValProvider({
  children,
  client,
  dispatchValEvents,
}: {
  children: React.ReactNode;
  client: ValClient;
  dispatchValEvents: boolean;
}) {
  const {
    addPatch,
    schemas,
    schemaSha,
    stat,
    sources,
    sourcesSyncStatus,
    patchesStatus,
    patchIds,
  } = useValState(client, dispatchValEvents);

  // Global debounce: to avoid canceling patches that are debounced on navigation
  const debouncedPatches = useRef<Record<SourcePath, (() => Patch)[]>>({});
  useEffect(() => {
    setInterval(() => {
      if (Object.keys(debouncedPatches.current).length === 0) {
        return;
      }
      for (const [pathS, patches] of Object.entries(debouncedPatches.current)) {
        const path = pathS as SourcePath;
        const [moduleFilePath] =
          Internal.splitModuleFilePathAndModulePath(path);
        for (const getPatch of patches) {
          addPatch(moduleFilePath, getPatch());
        }
      }
      debouncedPatches.current = {};
    }, 200);
  }, [addPatch]);
  const addDebouncedPatch = useCallback(
    (get: () => Patch, path: SourcePath) => {
      if (!debouncedPatches.current[path]) {
        debouncedPatches.current[path] = [];
      }
      debouncedPatches.current[path].push(get);
    },
    [],
  );
  const config =
    "data" in stat && stat.data ? (stat.data?.config as ValConfig) : undefined;

  const [theme, setTheme] = useState<Themes | null>(null);
  useEffect(() => {
    if (!config) {
      return;
    }
    try {
      const storedTheme = localStorage.getItem(
        "val-theme-" + (config.project || "unknown"),
      );
      if (storedTheme) {
        if (storedTheme === "light" || storedTheme === "dark") {
          setTheme(storedTheme);
        } else {
          throw new Error(`Invalid Val theme: ${storedTheme}`);
        }
      }
    } catch (e) {
      console.error("Error getting theme from local storage", e);
    }
  }, [config]);
  useEffect(() => {
    if (config?.defaultTheme && theme === null) {
      if (config?.defaultTheme === "dark" || config?.defaultTheme === "light") {
        setTheme(config.defaultTheme);
      } else {
        console.warn(`Invalid config default theme: ${config.defaultTheme}`);
      }
    } else if (config !== undefined && theme === null) {
      setTheme("dark");
    }
  }, [theme, config?.defaultTheme]);

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const publish = useCallback(() => {
    client("/save", "POST", {
      body: {
        patchIds,
      },
    })
      .then((res) => {
        if (res.status === 200) {
          setIsPublishing(false);
          setPublishError(null);
        } else {
          setPublishError(res.json.message);
        }
      })
      .catch((err) => {
        setPublishError(err.message);
        setIsPublishing(false);
      });
  }, [client, patchIds]);
  const getPatches = useCallback(
    async (patchIds: PatchId[]): Promise<GetPatchRes> => {
      const res = await client("/patches/~", "GET", {
        query: {
          omit_patch: false,
          patch_id: patchIds,
          author: [],
          module_file_path: [],
        },
      });
      if (res.status === 200) {
        return { status: "ok", data: res.json.patches } as const;
      }
      return { status: "error", error: res.json.message } as const;
    },
    [client],
  );
  return (
    <ValContext.Provider
      value={{
        addPatch,
        getPatches,
        addDebouncedPatch,
        theme,
        setTheme: (theme) => {
          if (theme === "dark" || theme === "light") {
            try {
              localStorage.setItem(
                "val-theme-" + (config?.project || "unknown"),
                theme,
              );
            } catch (e) {
              console.error("Error setting theme in local storage", e);
            }
            setTheme(theme);
          } else {
            console.warn(`Cannot set invalid theme theme: ${theme}`);
          }
        },
        publish,
        isPublishing,
        publishError,
        config,
        schemas,
        schemaSha,
        sources,
        sourcesSyncStatus,
        patchesStatus,
        patchIds,
      }}
    >
      <DayPickerProvider
        initialProps={{
          mode: "default",
        }}
      >
        {children}
      </DayPickerProvider>
    </ValContext.Provider>
  );
}
export type Themes = "dark" | "light";

export function useTheme(): Themes | null {
  const { theme } = useContext(ValContext);
  return theme;
}

export function useValConfig() {
  const { config } = useContext(ValContext);
  const lastConfig = useRef<ValConfig | undefined>(config);
  useEffect(() => {
    if (config) {
      lastConfig.current = config;
    }
  }, [config]);
  return lastConfig.current;
}

export function useAddPatch(sourcePath: SourcePath) {
  const { addPatch, addDebouncedPatch } = useContext(ValContext);
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const patchPath = useMemo(() => {
    return Internal.createPatchPath(modulePath);
  }, [modulePath]);
  const addPatchCallback = useCallback(
    (patch: Patch) => {
      addPatch(moduleFilePath, patch);
    },
    [addPatch, sourcePath],
  );

  return { patchPath, addPatch: addPatchCallback, addDebouncedPatch };
}

export function useGetPatches() {
  const { getPatches } = useContext(ValContext);

  return { getPatches };
}

export function useCurrentPatchIds(): PatchId[] {
  const { patchIds } = useContext(ValContext);
  return patchIds;
}

export type LoadingStatus = "loading" | "not-asked" | "error" | "success";
export function useLoadingStatus(): LoadingStatus {
  const { sourcesSyncStatus } = useContext(ValContext);
  return useMemo(() => {
    if (
      Object.values(sourcesSyncStatus).some(
        (status) => status.status === "loading",
      )
    ) {
      return "loading";
    }
    if (
      Object.values(sourcesSyncStatus).some(
        (status) => status.status === "error",
      )
    ) {
      return "error";
    }
    return "success";
  }, [sourcesSyncStatus]);
}

export function useSyncStatus() {
  const { sourcesSyncStatus } = useContext(ValContext);
  return sourcesSyncStatus;
}

export function usePublish() {
  const { publish, isPublishing, publishError } = useContext(ValContext);
  return { publish, isPublishing, publishError };
}

type EnsureAllTypes<T extends Record<SerializedSchema["type"], unknown>> = T;
/**
 * A shallow source is the source that is just enough to render each type of schema.
 * For example, if the schema is an object, the shallow source will contain the keys of the object and the source paths to the values below.
 * Primitive values are complete, but shallow source guarantees does only a minimum amount of validation:
 * object with _ref for files and images, string is a string, richtext is an array, etc.
 *
 * The sources must be validated properly to ensure that the source is indeed correct.
 *
 * The general idea is to avoid re-rendering the entire source tree when a single value changes.
 */
export type ShallowSource = EnsureAllTypes<{
  array: SourcePath[];
  object: Record<string, SourcePath>;
  record: Record<string, SourcePath>;
  union: string | Record<string, SourcePath>;
  boolean: boolean;
  keyOf: string;
  number: number;
  string: string;
  date: string;
  file: { [FILE_REF_PROP]: string };
  image: { [FILE_REF_PROP]: string };
  literal: string;
  richtext: unknown[];
}>;

export function useSchemaAtPath(sourcePath: SourcePath) {
  const { schemas, sources } = useContext(ValContext);
  const getMemoizedResolvedSchema = useCallback(():
    | { status: "not-found" }
    | { status: "loading" }
    | {
        status: "success";
        data: SerializedSchema;
      }
    | {
        status: "error";
        error: string;
      } => {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(sourcePath);
    const moduleSources = sources[moduleFilePath];
    if (schemas.status === "error") {
      return schemas;
    } else if (schemas.status === "not-asked") {
      return { status: "loading" };
    } else if (schemas.status === "loading") {
      return { status: "loading" };
    } else if (moduleSources === undefined) {
      return { status: "not-found" };
    }
    const moduleSchema = schemas.data[moduleFilePath];
    try {
      const { schema } = Internal.resolvePath(
        modulePath,
        moduleSources,
        moduleSchema,
      );
      if (schema === undefined) {
        return { status: "not-found" };
      }
      return {
        status: "success",
        data: schema,
      };
    } catch (e) {
      return {
        status: "error",
        error:
          e instanceof Error
            ? e.message
            : "Unknown error: " + JSON.stringify(e),
      };
    }
  }, [sourcePath, sources, schemas]);

  return useMemo(getMemoizedResolvedSchema, [
    // NOTE: we avoid depending on sources directly, and depend on the shallowSource to avoid unnecessary re-renders
    // TODO: optimize re-renders:
    // shallowSource, // Not sure if this helps
    sources,
    sourcePath,
    schemas,
  ]);
}

export function useSchemas() {
  return useContext(ValContext).schemas;
}

export function useSchemaSha() {
  return useContext(ValContext).schemaSha;
}

export function useGlobalError() {
  // sync errors, schema errors, patch errors, validation errors
}

type ShallowSourceOf<SchemaType extends SerializedSchema["type"]> =
  | { status: "not-found" }
  | {
      status: "success";
      data: ShallowSource[SchemaType] | null; // we add union to allow for nullable values
    }
  | {
      status: "loading";
      data?: ShallowSource[SchemaType] | null;
    }
  | {
      status: "error";
      data?: ShallowSource[SchemaType] | null;
      error: string;
    };

/**
 * A shallow source is the source that is just enough to render each type of schema.
 * @see ShallowSource for more information.
 *
 * The general idea is to avoid re-rendering the entire source tree when a single value changes.
 */
export function useShallowSourceAtPath<
  SchemaType extends SerializedSchema["type"],
>(sourcePath?: SourcePath, type?: SchemaType): ShallowSourceOf<SchemaType> {
  const { sources, sourcesSyncStatus } = useContext(ValContext);
  if (sourcePath === undefined) {
    return { status: "loading" };
  }
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const source = useMemo((): ShallowSourceOf<SchemaType> => {
    const moduleSources = sources[moduleFilePath];
    if (moduleSources !== undefined && type !== undefined) {
      const sourceAtSourcePath = getShallowSourceAtSourcePath(
        moduleFilePath,
        modulePath,
        type,
        moduleSources,
      );
      return sourceAtSourcePath;
    } else {
      return { status: "not-found" };
    }
  }, [sources[moduleFilePath], sourcePath, type]);

  const status = useMemo(() => {
    return sourcesSyncStatus[moduleFilePath];
  }, [moduleFilePath, sourcesSyncStatus]);
  if ("data" in source && status?.status === "loading") {
    return { status: "loading", data: source.data };
  }
  if (status?.status === "error") {
    return {
      status: "error",
      data: "data" in source ? source.data : undefined,
      error: status.errors.join(", "),
    };
  }
  return source;
}

export function useSourceAtPath(sourcePath: SourcePath) {
  const { sources } = useContext(ValContext);

  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  return walkSourcePath(modulePath, sources[moduleFilePath]);
}

function walkSourcePath(
  modulePath: ModulePath,
  sources?: Json,
):
  | {
      status: "success";
      data: Json;
    }
  | {
      status: "error";
      error: string;
    }
  | {
      status: "not-found";
    }
  | {
      status: "loading";
    } {
  let source = sources;
  if (sources === undefined) {
    return { status: "not-found" };
  }
  for (const part of Internal.splitModulePath(modulePath)) {
    // We allow null at the leaf node, but NOT in the middle of the path
    if (source === null) {
      return {
        status: "error",
        error: `Expected object at ${modulePath}, got null`,
      };
    }
    // We never allow undefined
    if (source === undefined) {
      return {
        status: "error",
        error: `Expected object at ${modulePath}, got undefined`,
      };
    }
    // Since the source path is not at the end leaf node, we expect an object / array.
    if (typeof source !== "object") {
      return {
        status: "error",
        error: `Expected object at ${modulePath}, got ${JSON.stringify(source)}`,
      };
    }
    if (isJsonArray(source)) {
      const index = Number(part);
      if (Number.isNaN(index)) {
        return {
          status: "error",
          error: `Expected number at ${modulePath}, got ${part}`,
        };
      }
      source = source[index];
    } else {
      source = source[part];
    }
  }
  // We never allow undefined
  if (source === undefined) {
    return {
      status: "error",
      error: `Expected object at ${modulePath}, got undefined`,
    };
  }
  return { status: "success", data: source };
}

function getShallowSourceAtSourcePath<
  SchemaType extends SerializedSchema["type"],
>(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath,
  type: SchemaType,
  sources: Json,
): ShallowSourceOf<SchemaType> {
  const source = walkSourcePath(modulePath, sources);
  if ("data" in source && source.data !== undefined) {
    const mappedSource = mapSource(
      moduleFilePath,
      modulePath,
      type,
      source.data,
    );
    return mappedSource;
  }
  return source as ShallowSourceOf<SchemaType>;
}

function mapSource<SchemaType extends SerializedSchema["type"]>(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath,
  schemaType: SchemaType,
  source: Json,
):
  | {
      status: "success";
      data: ShallowSource[SchemaType] | null;
    }
  | {
      status: "error";
      error: string;
    } {
  if (source === null) {
    return { status: "success", data: null };
  }
  const type: SerializedSchema["type"] = schemaType;
  if (type === "object" || type === "record") {
    if (typeof source !== "object") {
      return {
        status: "error",
        error: `Expected object, got ${typeof source}`,
      };
    }
    if (isJsonArray(source)) {
      return {
        status: "error",
        error: `Expected object, got array`,
      };
    }
    const data: ShallowSource["object" | "record"] = {};
    for (const key of Object.keys(source)) {
      data[key] = concatModulePath(moduleFilePath, modulePath, key);
    }
    return {
      status: "success",
      data: data as ShallowSource[SchemaType],
    };
  } else if (type === "array") {
    if (typeof source !== "object" || !isJsonArray(source)) {
      return {
        status: "error",
        error: `Expected array, got ${typeof source}`,
      };
    }
    const data: ShallowSource["array"] = [];
    for (let i = 0; i < source.length; i++) {
      data.push(concatModulePath(moduleFilePath, modulePath, i));
    }
    return {
      status: "success",
      data: data as ShallowSource[SchemaType],
    };
  } else if (type === "boolean") {
    if (typeof source !== "boolean" && source !== null) {
      return {
        status: "error",
        error: `Expected boolean, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (type === "number") {
    if (typeof source !== "number" && source !== null) {
      return {
        status: "error",
        error: `Expected number, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (type === "richtext") {
    if (typeof source !== "object" || !isJsonArray(source)) {
      return {
        status: "error",
        error: `Expected richtext (i.e. array), got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (type === "date" || type === "string" || type === "literal") {
    if (typeof source !== "string" && source !== null) {
      return {
        status: "error",
        error: `Expected string, got ${typeof source}: ${JSON.stringify(source)}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (type === "file" || type === "image") {
    if (
      typeof source !== "object" ||
      !(FILE_REF_PROP in source) ||
      source[FILE_REF_PROP] === undefined
    ) {
      return {
        status: "error",
        error: `Expected object with ${FILE_REF_PROP} property, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (type === "keyOf") {
    if (typeof source !== "string") {
      return {
        status: "error",
        error: `Expected string, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (type === "union") {
    if (typeof source === "string") {
      return {
        status: "success",
        data: source as ShallowSource[SchemaType],
      };
    }
    if (typeof source !== "object") {
      return {
        status: "error",
        error: `Expected object, got ${typeof source}`,
      };
    }
    if (isJsonArray(source)) {
      return {
        status: "error",
        error: `Expected object, got array`,
      };
    }
    const data: ShallowSource["union"] = {};
    for (const key of Object.keys(source)) {
      data[key] = concatModulePath(moduleFilePath, modulePath, key);
    }
    return {
      status: "success",
      data: data as ShallowSource[SchemaType],
    };
  } else {
    const exhaustiveCheck: never = type;
    return {
      status: "error",
      error: `Unknown schema type: ${exhaustiveCheck}`,
    };
  }
}

type GetPatchRes =
  | {
      status: "ok";
      data: Partial<
        Record<
          PatchId,
          {
            path: ModuleFilePath;
            createdAt: string;
            authorId: string | null;
            appliedAt: {
              baseSha: string;
              timestamp: string;
              git?:
                | {
                    commitSha: string;
                  }
                | undefined;
            } | null;
            patch?: Patch | undefined;
          }
        >
      >;
    }
  | {
      status: "error";
      error: string;
    };
function concatModulePath(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath,
  key: string | number,
): SourcePath {
  if (!modulePath) {
    return (moduleFilePath + ModuleFilePathSep + key) as SourcePath;
  }
  return (moduleFilePath +
    ModuleFilePathSep +
    modulePath +
    "." +
    JSON.stringify(key)) as SourcePath;
}
