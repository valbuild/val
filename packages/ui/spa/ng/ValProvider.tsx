import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  Internal,
  Json,
  ModuleFilePath,
  ModulePath,
  SerializedSchema,
  SourcePath,
  PatchId as PatchId,
} from "@valbuild/core";
import fakeModules from "./fakeContent/val.modules";
import { Remote } from "../utils/Remote";
import { Patch } from "@valbuild/core/patch";
import { PatchSets, SerializedPatchSet } from "../utils/PatchSet";
import FlexSearch from "flexsearch";
import { createSearchIndex, search } from "../search";
import { ValClient } from "@valbuild/shared/internal";
import { useValState } from "./useValState";

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
}>({
  search: false,
  setSearch: () => {
    throw new Error("UIContext not provided");
  },
});

async function getFakeModuleDefs() {
  const moduleDefs = await Promise.all(
    fakeModules.modules.map(async (module) => {
      return module.def().then((module) => module.default);
    }),
  );
  const test: Record<
    ModuleFilePath,
    {
      source: Json;
      schema?: SerializedSchema;
    }
  > = {};
  for (const moduleDef of moduleDefs) {
    const path = Internal.getValPath(moduleDef) as unknown as ModuleFilePath;
    if (!path) {
      throw new Error("No path found for module");
    }
    test[path] = {
      source: Internal.getSource(moduleDef),
      schema: Internal.getSchema(moduleDef)?.serialize(),
    };
  }
  return moduleDefs;
}

async function getFakeSearchData() {
  const moduleDefs = await Promise.all(
    fakeModules.modules.map(async (module) => {
      return module.def().then((module) => module.default);
    }),
  );
  const test: Record<
    ModuleFilePath,
    {
      source: Json;
      schema: SerializedSchema;
    }
  > = {};
  for (const moduleDef of moduleDefs) {
    const path = Internal.getValPath(moduleDef) as unknown as ModuleFilePath;
    if (!path) {
      throw new Error("No path found for module");
    }
    test[path] = {
      source: Internal.getSource(moduleDef),
      schema: Internal.getSchema(moduleDef)!.serialize(),
    };
  }
  return test;
}

/**
 * Use this for remote data that can be updated (is changing).
 * Use Remote for data that requires a refresh to update
 */
export type UpdatingRemote<T> =
  | {
      status: "not-asked"; // no data has been requested
    }
  | {
      status: "loading"; // data is loading
    }
  | {
      status: "success"; // data has been loaded
      data: T;
    }
  | {
      status: "updating"; // updating with new data
      data: T;
    }
  | {
      status: "error"; // an error occurred
      errors: string[] | string;
      data?: T;
    };
export function ValProvider({
  children,
  client,
  statInterval,
}: {
  children: React.ReactNode;
  client: ValClient;
  statInterval?: number;
}) {
  const [search, setSearch] = useState<
    false | { type?: "error" | "change"; query?: string }
  >(false);

  const { stat, schemas, sources, patchData, errors } = useValState(client);
  return (
    <ValContext.Provider
      value={{
        stat,
        schemas,
        sources,
        patchData,
        errors,
        search,
        setSearch,
      }}
    >
      {children}
    </ValContext.Provider>
  );
}

export function useSchemas(): Remote<Record<ModuleFilePath, SerializedSchema>> {
  const { getSchemasByModuleFilePath } = useContext(ValContext);
  const [schemas, setSchemas] = useState<
    Remote<Record<ModuleFilePath, SerializedSchema>>
  >({
    status: "not-asked",
  });

  useEffect(() => {
    getSchemasByModuleFilePath()
      .then((schemas) => {
        setSchemas({ status: "success", data: schemas });
      })
      .catch((err: Error) => {
        setSchemas({ status: "error", error: err.message });
      });
  }, [getSchemasByModuleFilePath]);

  return schemas;
}

export function useModuleSourceAndSchema(path: SourcePath): Remote<{
  moduleFilePath: ModuleFilePath;
  modulePath: ModulePath;
  schema: SerializedSchema;
  source: Json;
}> {
  // We could have one end point that get schema & source for a path
  const schemas = useSchemas();
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const moduleSource = useModuleSource(moduleFilePath);
  return useMemo(() => {
    if (schemas.status === "success" && moduleSource.status === "success") {
      const { schema, source } = Internal.resolvePath(
        modulePath,
        moduleSource.data,
        schemas.data[moduleFilePath],
      );
      return {
        status: "success",
        data: {
          moduleFilePath,
          modulePath,
          schema: schema,
          source: source,
        },
      };
    } else if (schemas.status !== "error" && moduleSource.status === "error") {
      return moduleSource;
    } else if (schemas.status === "error" && moduleSource.status !== "error") {
      return schemas;
    } else if (schemas.status === "error" && moduleSource.status === "error") {
      return {
        status: "error",
        error: `Failed to load schema and module. Schema error: ${schemas.error}. Module error: ${moduleSource.error}`,
      };
    } else if (
      schemas.status === "loading" ||
      moduleSource.status === "loading"
    ) {
      return {
        status: "loading",
      };
    } else {
      return {
        status: "not-asked",
      };
    }
  }, [path, schemas]);
}

export function useNavigation() {
  const { navigate, currentSourcePath } = useContext(ValContext);
  return {
    navigate,
    currentSourcePath,
  };
}

export function useModuleSource(
  moduleFilePath: ModuleFilePath | null,
): Remote<Json> {
  const { getSourceContent } = useContext(ValContext);
  const [sourceContent, setSourceContent] = useState<Remote<Json>>({
    status: "not-asked",
  });

  useEffect(() => {
    if (!moduleFilePath) {
      setSourceContent({ status: "success", data: null });
      return;
    }
    getSourceContent(moduleFilePath)
      .then((content) => {
        setSourceContent({ status: "success", data: content });
      })
      .catch((err: Error) => {
        setSourceContent({ status: "error", error: err.message });
      });
  }, [getSourceContent]);

  return sourceContent;
}

export function useAllModuleSources(): Remote<Record<ModuleFilePath, Json>> {
  const { getSchemasByModuleFilePath, getSourceContent } =
    useContext(ValContext);
  const [sources, setSources] = useState<Remote<Record<ModuleFilePath, Json>>>({
    status: "not-asked",
  });

  useEffect(() => {
    getSchemasByModuleFilePath()
      .then(async (schemas) => {
        const sources: Record<ModuleFilePath, Json> = {};
        for (const moduleFilePath in schemas) {
          sources[moduleFilePath as ModuleFilePath] = await getSourceContent(
            moduleFilePath as ModuleFilePath,
          );
        }
        setSources({ status: "success", data: sources });
      })
      .catch((err: Error) => {
        setSources({ status: "error", error: err.message });
      });
  }, [getSchemasByModuleFilePath]);
  return sources;
}

// #region Patches

const fakePatches: Record<string, PatchWithMetadata[]> = {
  "/content/employees/employeeList.val.ts": [
    {
      patchId: "1",
      author: {
        id: "1",
        name: "Fredrik Ekholdt",
        avatar: "https://avatars.githubusercontent.com/u/91758?s=400&v=4",
      },
      createdAt: "2024-08-12T12:00:00Z",
      patch: [
        {
          op: "replace",
          path: ["fe", "name"],
          value: 'Freddy "The Fish" Fish', // thx copilot
        },
      ],
    },
    {
      patchId: "2",
      author: {
        id: "1",
        name: "Fredrik Ekholdt",
        avatar: "https://avatars.githubusercontent.com/u/91758?s=400&v=4",
      },
      createdAt: "2024-09-01T12:00:00Z",
      patch: [
        {
          op: "replace",
          path: ["fe", "name"],
          value: "Fredr",
        },
      ],
    },
    {
      patchId: "5",
      author: {
        id: "1",
        name: "Fredrik Ekholdt",
        avatar: "https://avatars.githubusercontent.com/u/91758?s=400&v=4",
      },
      createdAt: "2024-09-07T12:00:00Z",
      patch: [
        {
          op: "replace",
          path: ["mkd", "name"],
          value: "Heia Magne!",
        },
      ],
    },
    {
      patchId: "3",
      author: {
        id: "1",
        name: "Fredrik Ekholdt",
        avatar: "https://avatars.githubusercontent.com/u/91758?s=400&v=4",
      },
      createdAt: "2024-09-07T12:00:00Z",
      patch: [
        {
          op: "replace",
          path: ["fe", "name"],
          value: "k Ekholdt",
        },
      ],
    },
  ],
};

export type Author = {
  id: string;
  name: string;
  avatar: string;
};

/** Used by fake data so we do not have to type assert all.the.f***king.time. */
type FakePatchId = string;

// Fake patch metadata - this type should be replaced with the real one...
// The UI probably needs render grouped patches, should that be done client side or server side?
// Pros: client side makes the API more stable, cons: slower UI? Does it even matter?
export type PatchWithMetadata = {
  patchId: FakePatchId;
  patch: Patch;
  author: Author | null;
  createdAt: string;
  error: string | null;
};
export function usePatches() {
  const [patches, setPatches] = useState<
    Remote<Record<ModuleFilePath, PatchWithMetadata[]>>
  >({
    status: "not-asked",
  });
  useEffect(() => {
    setTimeout(() => {
      setPatches({
        status: "success",
        data: fakePatches,
      });
    }, 1000); // fake delay
  }, []);
  return {
    patches,
  };
}

export function usePatchSets() {
  const { getSourceContent, getSchemasByModuleFilePath } =
    useContext(ValContext);
  const [patchSets, setPatchSets] = useState<Remote<SerializedPatchSet>>({
    status: "not-asked",
  });
  const { patches: allPatches } = usePatches();
  useEffect(() => {
    const timeout = setTimeout(async () => {
      const allSchemas = await getSchemasByModuleFilePath();
      if (allPatches.status !== "success") {
        return setPatchSets(allPatches);
      }
      const res = await Promise.all(
        Object.entries(allPatches.data).map(
          async ([moduleFilePathS, patches]) => {
            const moduleFilePath = moduleFilePathS as ModuleFilePath;
            const source = await getSourceContent(moduleFilePath);
            const schema = allSchemas[moduleFilePath];
            if (!schema) {
              throw new Error("No schema found for module: " + moduleFilePath);
            }
            return [moduleFilePath, { patches, source, schema }] as const;
          },
        ),
      );
      const data = Object.fromEntries(res);

      const patchSets = new PatchSets();
      const patchesById: Record<FakePatchId, PatchWithMetadata> = {};
      for (const moduleFilePathS in data) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        const { patches, source, schema } = data[moduleFilePath];
        for (const patch of patches) {
          patchesById[patch.patchId as FakePatchId] = patch;
          for (const op of patch.patch) {
            patchSets.insert(
              moduleFilePath,
              source,
              schema,
              op,
              patch.patchId as PatchId,
            );
          }
        }
      }
      setPatchSets({
        status: "success",
        data: patchSets.serialize(),
      });
    }, 100); // fake delay to simulate loading from server

    return () => {
      clearTimeout(timeout);
    };
  }, [allPatches]);
  const patchMetadataByPatchId: Remote<Record<PatchId, PatchWithMetadata>> =
    useMemo(() => {
      if (allPatches.status === "success") {
        const res: Record<PatchId, PatchWithMetadata> = {};
        for (const moduleFilePathS in allPatches.data) {
          const moduleFilePath = moduleFilePathS as ModuleFilePath;
          for (const patch of allPatches.data[moduleFilePath]) {
            res[patch.patchId as PatchId] = patch;
          }
        }
        return {
          status: "success",
          data: res,
        };
      }
      return allPatches;
    }, [allPatches]);

  return {
    patchSets,
    patchMetadataByPatchId,
  };
}

export type ValError =
  | {
      type: "validationError";
      message: string;
    }
  | {
      type: "patchError";
      message: string;
    }
  | {
      // should the UI be responsible for "handling" errors? That makes sense right now, but not sure if it will in the future
      type: "typeError" | "schemaError" | "unknownError";
      message: string;
    };
const fakeErrors: Record<SourcePath, ValError[]> = {
  ['/content/employees/employeeList.val.ts?p="fe"."name"' as SourcePath]: [
    {
      type: "validationError",
      message: '"name" must be at least 3 characters long',
    },
  ],
};
export function useErrors() {
  const [errors, setErrors] = useState<Remote<Record<SourcePath, ValError[]>>>({
    status: "not-asked",
  });
  useEffect(() => {
    setTimeout(() => {
      setErrors({
        status: "success",
        data: fakeErrors,
      });
    }, 1000); // fake delay
  }, []);
  return { errors };
}

export function useErrorsOfPath(path: SourcePath): Remote<ValError[]> {
  const { errors } = useErrors();
  return useMemo(() => {
    if (errors.status === "success") {
      return {
        status: "success",
        data: errors.data[path] || [],
      };
    } else {
      return errors;
    }
  }, [path, errors]);
}

export function usePatchesOfPath(
  path: SourcePath,
): Remote<PatchWithMetadata[]> {
  const { patches } = usePatches();
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  return useMemo(() => {
    if (patches.status === "success") {
      return {
        status: "success",
        data:
          patches.data[moduleFilePath]?.filter((value) => {
            return value.patch.some((op) => {
              return Internal.patchPathToModulePath(op.path) === modulePath;
            });
          }) || [],
      };
    } else {
      return patches;
    }
  }, [path, patches]);
}

// type DeploymentMetadata = {
//   patch_ids: PatchId[];
//   created_at: string;
//   created_by: {
//     name: string;
//     avatar: string;
//   };
//   triggered_by: "val" | "git-commit";
// };
// const fakeDeployments: DeploymentMetadata[] = [
//   {
//     patch_ids: ["1", "2", "3"],
//     created_at: new Date().toISOString(),
//     created_by: {
//       name: "Fredrik Ekholdt",
//       avatar: "https://avatars.githubusercontent.com/u/91758?s=400&v=4",
//     },
//     triggered_by: "val",
//   },
// ];

export function useSearch() {
  const { search, setSearch } = useContext(ValContext);
  return {
    search,
    setSearch,
  };
}

export type SearchResult = {
  schemaType: SerializedSchema["type"];
  sourcePath: SourcePath;
};
export function useSearchResults(params: {
  query: string;
  patches: FakePatchId[]; // TODO: use patches
}): Remote<SearchResult[]> {
  const [allSourcesAndSchemas, setAllSourcesAndSchemas] = useState<
    Remote<Record<ModuleFilePath, { source: Json; schema: SerializedSchema }>>
  >({
    status: "not-asked",
  });

  const [index, setIndex] = useState<Remote<FlexSearch.Index>>({
    status: "not-asked",
  });

  useEffect(() => {
    setAllSourcesAndSchemas({ status: "loading" });
    getFakeSearchData()
      .then((data) => {
        setAllSourcesAndSchemas({
          status: "success",
          data: data,
        });
      })
      .catch((err) => {
        setAllSourcesAndSchemas({
          status: "error",
          error: err.message,
        });
      });
  }, []);

  useEffect(() => {
    if (allSourcesAndSchemas.status === "success") {
      try {
        setIndex({ status: "loading" });
        const index = createSearchIndex(allSourcesAndSchemas.data);
        setIndex({
          status: "success",
          data: index,
        });
      } catch (err) {
        setIndex({
          status: "error",
          error: err instanceof Error ? err.message : JSON.stringify(err),
        });
      }
    }
  }, [allSourcesAndSchemas]);

  const [results, setResults] = useState<Remote<SearchResult[]>>({
    status: "not-asked",
  });

  useEffect(() => {
    if (params.query === "") {
      setResults({
        status: "success",
        data: [],
      });
    } else if (
      index.status === "success" &&
      allSourcesAndSchemas.status === "success" &&
      params.query
    ) {
      const results: SearchResult[] = search(index.data, params.query).map(
        (result) => {
          const [moduleFilePath, modulePath] =
            Internal.splitModuleFilePathAndModulePath(result);
          const schema = allSourcesAndSchemas.data[moduleFilePath].schema;
          const source = allSourcesAndSchemas.data[moduleFilePath].source;
          const { schema: schemaAtPath } = Internal.resolvePath(
            modulePath,
            source,
            schema,
          );
          return {
            schemaType: schemaAtPath.type,
            sourcePath: result,
          };
        },
      );
      setResults({
        status: "success",
        data: results,
      });
    } else if (index.status === "error") {
      setResults({
        status: "error",
        error: index.error,
      });
    } else if (allSourcesAndSchemas.status === "error") {
      setResults({
        status: "error",
        error: allSourcesAndSchemas.error,
      });
    } else if (
      allSourcesAndSchemas.status !== "success" ||
      index.status !== "success"
    ) {
      setResults({
        status: "loading",
      });
    }
  }, [index, allSourcesAndSchemas, params.query]);

  return results;
}
