import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  Internal,
  Json,
  ModuleFilePath,
  ModulePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import fakeModules from "./fakeContent/val.modules";
import { Remote } from "../utils/Remote";
import { Patch } from "@valbuild/core/patch";

const UIContext = React.createContext<{
  getSchemasByModuleFilePath: () => Promise<
    Record<ModuleFilePath, SerializedSchema>
  >;
  getSourceContent: (moduleFilePath: ModuleFilePath) => Promise<Json>;
  currentSourcePath: SourcePath | ModuleFilePath | null;
  navigate: (path: SourcePath | ModuleFilePath) => void;
  isPublishing: boolean;
  setIsPublishing: (isPublishing: boolean) => void;
  search:
    | false
    | {
        type: "error" | "change";
        query?: string;
      };
  setSearch: (
    search:
      | false
      | {
          type: "error" | "change";
          query?: string;
        }
  ) => void;
}>({
  getSchemasByModuleFilePath: (): never => {
    throw new Error("UIContext not provided");
  },
  getSourceContent: (): never => {
    throw new Error("UIContext not provided");
  },
  currentSourcePath: null,
  navigate: () => {
    throw new Error("UIContext not provided");
  },
  isPublishing: false,
  setIsPublishing: () => {
    throw new Error("UIContext not provided");
  },
  search: false,
  setSearch: () => {
    throw new Error("UIContext not provided");
  },
});

async function getFakeModuleDefs() {
  const moduleDefs = await Promise.all(
    fakeModules.modules.map(async (module) => {
      return module.def().then((module) => module.default);
    })
  );

  return moduleDefs;
}

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [currentSourcePath, setSourcePath] = useState<
    SourcePath | ModuleFilePath | null
  >("/content/basic.val.ts" as SourcePath); // TODO: just testing out /content/basic.val.ts for now
  // just fake state:
  const [isPublishing, setIsPublishing] = useState(false);
  const [search, setSearch] = useState<
    false | { type: "error" | "change"; query?: string }
  >(false);
  return (
    <UIContext.Provider
      value={{
        isPublishing,
        setIsPublishing,
        search,
        setSearch,
        currentSourcePath,
        navigate: (sourcePath) => {
          setSearch(false);
          setSourcePath(sourcePath);
        },
        getSourceContent: async (
          moduleFilePath: ModuleFilePath
        ): Promise<Json> => {
          const moduleDefs = await getFakeModuleDefs();

          const moduleDef = moduleDefs.find((module) => {
            const path = Internal.getValPath(module);
            return path === (moduleFilePath as unknown as SourcePath);
          });

          if (!moduleDef) {
            throw new Error("Module not found");
          }
          return Internal.getSource(moduleDef) as Json;
        },
        getSchemasByModuleFilePath: async () => {
          const moduleDefs = await getFakeModuleDefs();
          const schemaByModuleFilePath: Record<
            ModuleFilePath,
            SerializedSchema
          > = {};
          for (const module of moduleDefs) {
            const schema = Internal.getSchema(module);
            const path = Internal.getValPath(module);
            if (!path) {
              throw new Error("No path found for module");
            }
            if (!schema) {
              throw new Error("No schema found for module: " + path);
            }
            schemaByModuleFilePath[path as unknown as ModuleFilePath] =
              schema.serialize();
          }
          return schemaByModuleFilePath;
        },
      }}
    >
      {children}
    </UIContext.Provider>
  );
}

export function useSchemas(): Remote<Record<ModuleFilePath, SerializedSchema>> {
  const { getSchemasByModuleFilePath } = useContext(UIContext);
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
        schemas.data[moduleFilePath]
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
  const { navigate, currentSourcePath } = useContext(UIContext);
  return {
    navigate,
    currentSourcePath,
  };
}

export function useModuleSource(
  moduleFilePath: ModuleFilePath | null
): Remote<Json> {
  const { getSourceContent } = useContext(UIContext);
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

// #region Patches

const fakePatches: Record<string, PatchWithMetadata[]> = {
  "/content/employees/employeeList.val.ts": [
    {
      patch_id: "1",
      author: {
        name: "k Ekholdt",
        avatar: "https://avatars.githubusercontent.com/u/91758?s=400&v=4",
      },
      created_at: "2024-08-12T12:00:00Z",
      patch: [
        {
          op: "replace",
          path: ["fe", "name"],
          value: 'Freddy "The Fish" Fish', // thx copilot
        },
      ],
    },
    {
      patch_id: "2",
      author: {
        name: "k Ekholdt",
        avatar: "https://avatars.githubusercontent.com/u/91758?s=400&v=4",
      },
      created_at: "2024-09-01T12:00:00Z",
      patch: [
        {
          op: "replace",
          path: ["fe", "name"],
          value: "Fredr",
        },
      ],
    },
    {
      patch_id: "3",
      author: {
        name: "k Ekholdt",
        avatar: "https://avatars.githubusercontent.com/u/91758?s=400&v=4",
      },
      created_at: "2024-09-07T12:00:00Z",
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

/** Used by fake data so we do not have to type assert all.the.f***king.time. */
type PatchId = string;

// Fake patch metadata - this type should be replaced with the real one...
// The UI probably needs render grouped patches, should that be done client side or server side?
// Pros: client side makes the API more stable, cons: slower UI? Does it even matter?
type PatchWithMetadata = {
  patch_id: PatchId;
  patch: Patch;
  author: {
    name: string;
    avatar: string;
  };
  created_at: string;
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
    deletePatches: (patchIds: PatchId[]) => {
      setTimeout(() => {
        setPatches({
          status: "success",
          data: Object.fromEntries(
            Object.entries(fakePatches).map(([path, patches]) => [
              path,
              patches.filter((patch) => !patchIds.includes(patch.patch_id)),
            ])
          ),
        });
      }, 400);
    },
    // stashPatches: (patchIds: PatchId[]) => {},
  };
}

export type ValError =
  | {
      type: "validationError";
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

type DeploymentMetadata = {
  patch_ids: PatchId[];
  created_at: string;
  created_by: {
    name: string;
    avatar: string;
  };
  triggered_by: "val" | "git-commit";
};
const fakeDeployments: DeploymentMetadata[] = [
  {
    patch_ids: ["1", "2", "3"],
    created_at: new Date().toISOString(),
    created_by: {
      name: "Fredrik Ekholdt",
      avatar: "https://avatars.githubusercontent.com/u/91758?s=400&v=4",
    },
    triggered_by: "val",
  },
];
export function useDeployments() {
  const { isPublishing } = useValState();
  const [deployments, setDeployments] = useState<Remote<DeploymentMetadata[]>>({
    status: "not-asked",
  });
  useEffect(() => {
    if (isPublishing) {
      setDeployments({ status: "loading" });
      setTimeout(() => {
        setDeployments({
          status: "success",
          data: fakeDeployments,
        });
      }, 1000); // fake delay
    }
  }, [isPublishing]);
  return { deployments, estimatedDeploymentDurationSeconds: 60 + 30 };
}

// TODO: do we want a central place where global state should be managed? That would make sense right?
export function useValState() {
  const { isPublishing, setIsPublishing } = useContext(UIContext);
  return {
    publish: () => {
      if (!isPublishing) {
        setIsPublishing(true);
        setTimeout(() => {
          setIsPublishing(false);
        }, 5000); // fake delay
      }
    },
    isPublishing,
  };
}

export function useSearch() {
  const { search, setSearch } = useContext(UIContext);
  return {
    search,
    setSearch,
  };
}
