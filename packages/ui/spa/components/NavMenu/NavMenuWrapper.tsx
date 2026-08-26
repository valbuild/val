import { useCallback, useMemo } from "react";
import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { NavMenu } from "./NavMenu";
import { useNavMenuData } from "./useNavMenuData";
import { useSchemas } from "../ValFieldProvider";
import { useAddModuleFilePatch } from "../ValProvider";
import { useNavigation } from "../ValRouter";
import { emptyOf } from "../fields/emptyOf";
import { useAllValidationErrors } from "../ValErrorProvider";
import { NavMenuData, SitemapItem, ExplorerItem } from "./types";

function hasErrorAtPath(
  path: string,
  allErrors: Record<SourcePath, ValidationError[]>,
): boolean {
  for (const errorPath in allErrors) {
    if (
      errorPath === path ||
      errorPath.startsWith(path + Internal.ModuleFilePathSep) ||
      errorPath.startsWith(path + ".")
    ) {
      return true;
    }
  }
  return false;
}

function enrichSitemapItem(
  item: SitemapItem,
  allErrors: Record<SourcePath, ValidationError[]>,
): SitemapItem {
  const children = item.children.map((child) =>
    enrichSitemapItem(child, allErrors),
  );
  const childHasError = children.some((c) => c.hasError);
  const selfHasError = item.sourcePath
    ? hasErrorAtPath(item.sourcePath, allErrors)
    : false;
  return {
    ...item,
    children,
    hasError: selfHasError || childHasError,
  };
}

function enrichExplorerItem(
  item: ExplorerItem,
  allErrors: Record<SourcePath, ValidationError[]>,
): ExplorerItem {
  const children = item.children.map((child) =>
    enrichExplorerItem(child, allErrors),
  );
  const childHasError = children.some((c) => c.hasError);
  const selfHasError = !item.isDirectory
    ? hasErrorAtPath(item.fullPath, allErrors)
    : false;
  return {
    ...item,
    children,
    hasError: selfHasError || childHasError,
  };
}

function enrichNavMenuData(
  data: NavMenuData,
  allErrors: Record<SourcePath, ValidationError[]>,
): NavMenuData {
  const result: NavMenuData = { hasRouters: data.hasRouters };
  if (data.sitemap) {
    result.sitemap = enrichSitemapItem(data.sitemap, allErrors);
  }
  if (data.explorer) {
    result.explorer = enrichExplorerItem(data.explorer, allErrors);
  }
  if (data.external) {
    result.external = {
      ...data.external,
      hasError: hasErrorAtPath(data.external.moduleFilePath, allErrors),
    };
  }
  /**
   * Carried through, and forgetting it made every gallery unreachable.
   *
   * This function rebuilds `NavMenuData` from scratch rather than spreading it,
   * so a section it does not name is dropped — and `media` was not named. The
   * consequence was worse than a missing section, because `collectMediaModules`
   * also REMOVES galleries from the explorer tree on the grounds that they live
   * under Media: two entry points for one module is confusing. With Media gone,
   * an `s.images()` or `s.files()` module was in neither place, and the only way
   * to open one was to know its URL.
   *
   * Carried through as-is, unlike the sections above: `collectMediaModules`
   * already attributes errors per module, and `MediaModule` carries them as
   * `errors` rather than the `hasError` flag the other rows use. There is
   * nothing to enrich.
   */
  if (data.media && data.media.length > 0) {
    result.media = data.media;
  }
  return result;
}

/**
 * Wrapper component that connects NavMenu to the data layer.
 * Use this in the main Layout instead of NavMenu directly.
 */
export function NavMenuWrapper() {
  const navMenuData = useNavMenuData();
  const { addModuleFilePatch } = useAddModuleFilePatch();
  const schemas = useSchemas();
  const { navigate } = useNavigation();
  const allValidationErrors = useAllValidationErrors();

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

  const enrichedData = useMemo(() => {
    if (navMenuData.status !== "success") return null;
    return enrichNavMenuData(navMenuData.data, allValidationErrors);
  }, [navMenuData, allValidationErrors]);

  if (navMenuData.status === "error") {
    return <NavMenu data={{ hasRouters: false }} isLoading={false} />;
  }

  if (!enrichedData) {
    return <NavMenu data={{ hasRouters: false }} isLoading={true} />;
  }

  return (
    <NavMenu data={enrichedData} isLoading={false} onAddPage={handleAddPage} />
  );
}
