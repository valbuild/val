import React, { useContext, useEffect, useState } from "react";
import {
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import fakeModules from "./fakeContent/val.modules";
import { Remote } from "../utils/Remote";

const UIContext = React.createContext<{
  getSchemasByModuleFilePath: () => Promise<
    Record<ModuleFilePath, SerializedSchema>
  >;
  getSourceContent: (moduleFilePath: ModuleFilePath) => Promise<Json>;
  currentSourcePath: SourcePath | ModuleFilePath | null;
  navigate: (path: SourcePath | ModuleFilePath) => void;
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
  return (
    <UIContext.Provider
      value={{
        currentSourcePath,
        navigate: setSourcePath,
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
