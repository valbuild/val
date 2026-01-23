import { useCallback } from "react";
import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
} from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { NavMenuV2 } from "./NavMenuV2";
import { useNavMenuData } from "./useNavMenuData";
import { useSchemas } from "../ValFieldProvider";
import { useAddModuleFilePatch } from "../ValProvider";
import { useNavigation } from "../ValRouter";
import { emptyOf } from "../fields/emptyOf";

/**
 * Wrapper component that connects NavMenuV2 to the data layer.
 * Use this in the main Layout instead of NavMenuV2 directly.
 */
export function NavMenuV2Wrapper() {
  const navMenuData = useNavMenuData();
  const { addModuleFilePatch } = useAddModuleFilePatch();
  const schemas = useSchemas();
  const { navigate } = useNavigation();

  const handleAddPage = useCallback(
    (moduleFilePath: ModuleFilePath, urlPath: string) => {
      // Get the schema for this module
      if (schemas.status !== "success") {
        console.error("Schemas not loaded");
        return;
      }
      const schema = schemas.data[moduleFilePath];
      if (!schema || schema.type !== "record") {
        console.error("Schema not found or not a record", {
          moduleFilePath,
          schema,
        });
        return;
      }

      // Create the patch to add the new page
      const newPatchPath = Internal.createPatchPath("" as ModulePath).concat(
        urlPath
      );
      addModuleFilePatch(
        moduleFilePath,
        [
          {
            op: "add",
            path: newPatchPath,
            value: emptyOf(schema.item) as JSONValue,
          },
        ],
        "record"
      );

      // Navigate to the new page
      const sourcePath = Internal.joinModuleFilePathAndModulePath(
        moduleFilePath,
        Internal.patchPathToModulePath(newPatchPath)
      ) as SourcePath;
      navigate(sourcePath);
    },
    [addModuleFilePatch, schemas, navigate]
  );

  if (navMenuData.status === "error") {
    // Fallback to empty state on error
    return <NavMenuV2 data={{}} isLoading={false} />;
  }

  if (!("data" in navMenuData)) {
    return <NavMenuV2 data={{}} isLoading={true} />;
  }

  return (
    <NavMenuV2
      data={navMenuData.data}
      isLoading={false}
      onAddPage={handleAddPage}
    />
  );
}
