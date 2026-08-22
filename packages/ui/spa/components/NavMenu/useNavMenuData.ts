import { useMemo } from "react";
import {
  Internal,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { useTrees } from "../useTrees";
import {
  useShallowModulesAtPaths,
  useNextAppRouterSrcFolder,
} from "../ValProvider";
import { useSchemas } from "../ValFieldProvider";
import {
  getNextAppRouterSitemapTree,
  SitemapNode,
  PageNode,
  parseRoutePattern,
} from "@valbuild/shared/internal";
import { NavMenuData, SitemapItem, ExplorerItem } from "./types";
import { collectMediaModules } from "./media";
import {
  NavErrorsIndex,
  errorsForModuleFilePath,
  errorsForSitemapEntry,
  indexNavErrors,
} from "./navErrors";
import { PathNode } from "../../utils/pathTree";
import { Remote } from "../../utils/Remote";
import { useAllValidationErrors } from "../ValErrorProvider";

/**
 * Transforms a SitemapNode (from shared/internal) to our SitemapItem type.
 *
 * Each row carries `errors.ownCount` and `errors.firstMessage` derived from
 * validation errors keyed under this row's sourcePath. Descendant totals are
 * computed at render time by recursing children.
 */
function transformSitemapNode(
  node: SitemapNode | PageNode,
  navErrors: NavErrorsIndex,
  schemas?: Record<ModuleFilePath, SerializedSchema>,
): SitemapItem {
  const canAddChild = !!node.pattern?.includes("[");
  const routePattern =
    canAddChild && node.pattern ? parseRoutePattern(node.pattern) : undefined;

  // Get existing keys from children for validation in add form
  const existingKeys = canAddChild
    ? node.children.map((child) => "/" + child.name)
    : undefined;

  const sourcePath = node.sourcePath as SourcePath | undefined;
  const errors = sourcePath
    ? errorsForSitemapEntry(navErrors, sourcePath)
    : undefined;
  const moduleFilePath = node.moduleFilePath as ModuleFilePath | undefined;
  const routerSchema =
    canAddChild && moduleFilePath ? schemas?.[moduleFilePath] : undefined;
  const keyDescription =
    routerSchema?.type === "record" ? routerSchema.key?.description : undefined;

  return {
    name: node.name,
    urlPath: node.pattern || "/",
    sourcePath,
    moduleFilePath,
    canAddChild,
    routePattern,
    existingKeys,
    keyDescription,
    errors,
    children: node.children.map((child) =>
      transformSitemapNode(child, navErrors, schemas),
    ),
  };
}

/**
 * Transforms a PathNode to our ExplorerItem type.
 *
 * Files attribute every error whose sourcePath starts with the file's
 * fullPath. Directories don't get own errors — descendants are aggregated at
 * render time.
 */
function transformPathNode(
  node: PathNode,
  navErrors: NavErrorsIndex,
  excludedPaths: ReadonlySet<string>,
): ExplorerItem {
  const isDirectory = !!node.isDirectory;
  const errors =
    !isDirectory && node.fullPath
      ? errorsForModuleFilePath(navErrors, node.fullPath)
      : undefined;
  return {
    name: node.name,
    fullPath: node.fullPath,
    isDirectory,
    errors,
    children: node.children
      .filter((child) => !excludedPaths.has(child.fullPath))
      .map((child) => transformPathNode(child, navErrors, excludedPaths)),
  };
}

/**
 * Hook that provides navigation menu data in a simplified format.
 * Transforms the complex internal tree structures into the NavMenuData format.
 */
export function useNavMenuData(): Remote<NavMenuData> {
  const trees = useTrees();
  const sitemapPaths = useMemo(() => {
    if (trees.status !== "success") return [];
    return trees.data.routers["next-app-router"] || [];
  }, [trees]);

  const shallowModules = useShallowModulesAtPaths(sitemapPaths, "record");
  const srcFolder = useNextAppRouterSrcFolder();
  const validationErrors = useAllValidationErrors();
  const schemas = useSchemas();

  return useMemo((): Remote<NavMenuData> => {
    if (trees.status !== "success") {
      return trees;
    }

    // Indexed ONCE per render: the trees used to scan the whole error map for
    // every row, which is O(rows x errors) on every validation update.
    const navErrors = indexNavErrors(validationErrors ?? {});
    const data: NavMenuData = {};

    // Transform sitemap if available
    if (sitemapPaths.length > 0) {
      // Build sitemap tree
      if (
        srcFolder.status === "success" &&
        srcFolder.data &&
        shallowModules.status === "success" &&
        shallowModules.data
      ) {
        const paths: { urlPath: string; moduleFilePath: ModuleFilePath }[] = [];
        for (const shallowSource of shallowModules.data || []) {
          for (const path in shallowSource) {
            const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
              shallowSource[path],
            );
            paths.push({
              urlPath: path,
              moduleFilePath,
            });
          }
        }
        const sitemapTree = getNextAppRouterSitemapTree(srcFolder.data, paths);
        data.sitemap = transformSitemapNode(
          sitemapTree,
          navErrors,
          schemas.status === "success" ? schemas.data : undefined,
        );
      } else if (
        srcFolder.status === "loading" ||
        shallowModules.status === "loading"
      ) {
        return { status: "loading" };
      }
    }

    const media =
      schemas.status === "success"
        ? collectMediaModules(schemas.data, (moduleFilePath) =>
            errorsForModuleFilePath(navErrors, moduleFilePath),
          )
        : [];
    if (media.length > 0) {
      data.media = media;
    }
    const mediaPaths: ReadonlySet<string> = new Set(
      media.map((m) => m.moduleFilePath as string),
    );

    // Transform explorer tree if available
    if (trees.data.root && trees.data.root.children.length > 0) {
      const explorer = transformPathNode(
        trees.data.root,
        navErrors,
        mediaPaths,
      );
      // A tree that held nothing but galleries is now empty, so drop the
      // section rather than render an empty Explorer.
      if (explorer.children.length > 0) {
        data.explorer = explorer;
      }
    }

    // Add external module if available
    const externalPaths = trees.data.routers["external-url-router"];
    if (externalPaths && externalPaths.length > 0) {
      data.external = {
        moduleFilePath: externalPaths[0],
      };
    }

    return {
      status: "success",
      data,
    };
  }, [
    trees,
    sitemapPaths,
    srcFolder,
    shallowModules,
    validationErrors,
    schemas,
  ]);
}
