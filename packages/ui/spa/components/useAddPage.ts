import { useCallback } from "react";
import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
} from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { useSchemas } from "./ValFieldProvider";
import { useAddModuleFilePatch } from "./ValProvider";
import { useNavigation } from "./ValRouter";
import { emptyOf } from "@valbuild/shared/internal";

/**
 * Create a page under a router, and open it.
 *
 * A router module is a record keyed by URL path, so a new page is one `add` op
 * at that key with an empty value shaped by the router's item schema — which is
 * what `emptyOf` is for, and why this cannot be built from the URL alone.
 *
 * Extracted from the classic nav menu because the floating shell needs the same
 * write from two more places, and a second implementation of "what an empty page
 * looks like" is how two entry points come to create different pages.
 */
export function useAddPage(): (
  moduleFilePath: ModuleFilePath,
  urlPath: string,
) => void {
  const { addModuleFilePatch } = useAddModuleFilePatch();
  const schemas = useSchemas();
  const { navigate } = useNavigation();
  return useCallback(
    (moduleFilePath: ModuleFilePath, urlPath: string) => {
      if (schemas.status !== "success") {
        console.error("Val: cannot add a page before the schemas have loaded");
        return;
      }
      const schema = schemas.data[moduleFilePath];
      if (!schema || schema.type !== "record") {
        console.error(
          "Val: cannot add a page to a module that is not a record",
          {
            moduleFilePath,
            schema,
          },
        );
        return;
      }
      const patchPath = Internal.createPatchPath("" as ModulePath).concat(
        urlPath,
      );
      addModuleFilePatch(
        moduleFilePath,
        [
          {
            op: "add",
            path: patchPath,
            value: emptyOf(schema.item) as JSONValue,
          },
        ],
        "record",
      );
      // Straight into the page that was just made: creating one and being left
      // looking at the list is a step nobody wants.
      navigate(
        Internal.joinModuleFilePathAndModulePath(
          moduleFilePath,
          Internal.patchPathToModulePath(patchPath),
        ) as SourcePath,
      );
    },
    [addModuleFilePatch, schemas, navigate],
  );
}
