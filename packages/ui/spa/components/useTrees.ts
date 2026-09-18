import { ModuleFilePath } from "@valbuild/core";
import { useMemo } from "react";
import { Remote } from "../utils/Remote";
import { PathNode, pathTree } from "../utils/pathTree";
import { useSchemas } from "./ValFieldProvider";

/**
 * The module tree the nav's Explorer lists, and the routers beside it.
 *
 * A module whose ROOT schema is `hidden` is left out of the tree. A module has
 * no parent to be hidden from, so the only thing `hidden` can mean there is
 * "do not list this" — which is what makes `s.view()` worth having: a module
 * that many others `keyOf` into is noise in a listing and belongs on exactly
 * one page. It stays reachable and fully editable; the Explorer just stops
 * being the way in. Filtered here rather than at render, so `pathTree` never
 * creates a directory whose only occupant was hidden.
 */
export function useTrees(): Remote<{
  root: PathNode;
  routers: { [routerId: string]: ModuleFilePath[] };
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
        } else if (!schema.hidden) {
          moduleFilePaths.push(filePath);
        }
      }
      return {
        status: remoteSchemasByModuleFilePath.status,
        data: {
          root: pathTree(moduleFilePaths),
          routers: routerPaths,
        },
      };
    }
    return remoteSchemasByModuleFilePath;
  }, [remoteSchemasByModuleFilePath]);
}
