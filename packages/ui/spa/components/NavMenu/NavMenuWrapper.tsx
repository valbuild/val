import { useCallback } from "react";
import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
} from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { NavMenu } from "./NavMenu";
import { useNavMenuData } from "./useNavMenuData";
import { useSchemas } from "../ValFieldProvider";
import { useAddModuleFilePatch } from "../ValProvider";
import { useNavigation } from "../ValRouter";
import { emptyOf } from "../fields/emptyOf";

/**
 * Wrapper component that connects NavMenu to the data layer.
 * Use this in the main Layout instead of NavMenu directly.
 */
export function NavMenuWrapper() {
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
        urlPath,
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
        "record",
      );

      // Navigate to the new page
      const sourcePath = Internal.joinModuleFilePathAndModulePath(
        moduleFilePath,
        Internal.patchPathToModulePath(newPatchPath),
      ) as SourcePath;
      navigate(sourcePath);
    },
    [addModuleFilePatch, schemas, navigate],
  );

  if (navMenuData.status === "error") {
    // Fallback to empty state on error
    return <NavMenu data={{}} isLoading={false} />;
  }

  if (!("data" in navMenuData)) {
    return <NavMenu data={{}} isLoading={true} />;
  }

  return (
    <NavMenu
      data={navMenuData.data}
      isLoading={false}
      onAddPage={handleAddPage}
    />
  );
}
