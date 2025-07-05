import { ModuleFilePath } from "@valbuild/core";
import { useMemo } from "react";
import { Remote } from "../utils/Remote";
import { PathNode, pathTree } from "../utils/pathTree";
import { useSchemas } from "./ValProvider";

export function useTrees(): Remote<{
  root: PathNode;
  sitemap: { [routerId: string]: ModuleFilePath[] };
}> {
  const remoteSchemasByModuleFilePath = useSchemas();
  return useMemo(() => {
    if (remoteSchemasByModuleFilePath.status === "success") {
      const moduleFilePaths: ModuleFilePath[] = [];
      const routerPaths: { [routerId: string]: ModuleFilePath[] } = {};
      for (const filePathS in remoteSchemasByModuleFilePath.data) {
        const filePath = filePathS as ModuleFilePath;
        const schema = remoteSchemasByModuleFilePath.data[filePath];
        if (schema.type === "record" && schema.router) {
          routerPaths[schema.router] = routerPaths[schema.router] || [];
          routerPaths[schema.router].push(filePath);
        } else {
          moduleFilePaths.push(filePath);
        }
      }
      return {
        status: remoteSchemasByModuleFilePath.status,
        data: {
          root: pathTree(moduleFilePaths),
          sitemap: routerPaths,
        },
      };
    }
    return remoteSchemasByModuleFilePath;
  }, [remoteSchemasByModuleFilePath]);
}
