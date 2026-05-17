import { useMemo } from "react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { ValidationError } from "@valbuild/core";
import { useTrees } from "../useTrees";
import {
  useShallowModulesAtPaths,
  useNextAppRouterSrcFolder,
} from "../ValProvider";
import { Internal } from "@valbuild/core";
import {
  getNextAppRouterSitemapTree,
  SitemapNode,
  PageNode,
  parseRoutePattern,
} from "@valbuild/shared/internal";
import { NavMenuData, SitemapItem, ExplorerItem, NavItemErrors } from "./types";
import { PathNode } from "../../utils/pathTree";
import { Remote } from "../../utils/Remote";
import { useAllValidationErrors } from "../ValErrorProvider";

type ErrorsMap = Record<SourcePath, ValidationError[] | undefined>;

/**
 * Transforms a SitemapNode (from shared/internal) to our SitemapItem type.
 *
 * Each row carries `errors.ownCount` and `errors.firstMessage` derived from
 * validation errors keyed under this row's sourcePath. Descendant totals are
 * computed at render time by recursing children.
 */
function transformSitemapNode(
  node: SitemapNode | PageNode,
  errorsMap: ErrorsMap,
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
    ? collectErrorsForSitemapEntry(errorsMap, sourcePath)
    : undefined;

  return {
    name: node.name,
    urlPath: node.pattern || "/",
    sourcePath,
    moduleFilePath: node.moduleFilePath as ModuleFilePath | undefined,
    canAddChild,
    routePattern,
    existingKeys,
    errors,
    children: node.children.map((child) =>
      transformSitemapNode(child, errorsMap),
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
function transformPathNode(node: PathNode, errorsMap: ErrorsMap): ExplorerItem {
  const isDirectory = !!node.isDirectory;
  const errors =
    !isDirectory && node.fullPath
      ? collectErrorsForModuleFilePath(errorsMap, node.fullPath)
      : undefined;
  return {
    name: node.name,
    fullPath: node.fullPath,
    isDirectory,
    errors,
    children: node.children.map((child) => transformPathNode(child, errorsMap)),
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

  return useMemo((): Remote<NavMenuData> => {
    if (trees.status !== "success") {
      return trees;
    }

    const errorsMap: ErrorsMap = validationErrors ?? {};
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
        data.sitemap = transformSitemapNode(sitemapTree, errorsMap);
      } else if (
        srcFolder.status === "loading" ||
        shallowModules.status === "loading"
      ) {
        return { status: "loading" };
      }
    }

    // Transform explorer tree if available
    if (trees.data.root && trees.data.root.children.length > 0) {
      data.explorer = transformPathNode(trees.data.root, errorsMap);
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
  }, [trees, sitemapPaths, srcFolder, shallowModules, validationErrors]);
}

/**
 * Collect the errors that resolve to a single sitemap entry.
 *
 * A sitemap entry has a sourcePath like
 *   `/app/blogs/[blog]/page.val.ts?p="/blogs/blog-1"`
 * The errors map is keyed by the *path within the module*, e.g.
 *   `/app/blogs/[blog]/page.val.ts?p="/blogs/blog-1"."title"`
 *
 * An error belongs to a row if its key is the row's source path, or extends
 * into it via a `.` (sub-property of the record entry). This deliberately
 * avoids matching sibling record entries that share a prefix.
 */
function collectErrorsForSitemapEntry(
  errorsMap: ErrorsMap,
  sourcePath: SourcePath,
): NavItemErrors | undefined {
  let ownCount = 0;
  let firstMessage: string | undefined;
  const exactPrefix = `${sourcePath}.`;
  for (const keyString in errorsMap) {
    const key = keyString as SourcePath;
    if (key !== sourcePath && !keyString.startsWith(exactPrefix)) continue;
    const list = errorsMap[key];
    if (!list || list.length === 0) continue;
    ownCount += list.length;
    if (!firstMessage) firstMessage = list[0]?.message;
  }
  return ownCount > 0 ? { ownCount, firstMessage } : undefined;
}

/**
 * Collect the errors attributable to a single explorer file.
 *
 * Files have a fullPath like `/content/authors.val.ts`. Errors are keyed by
 * SourcePath which begins with the module file path, followed by `?p="..."`
 * or `?` at the boundary. A startsWith check on `fullPath` is safe because
 * sibling files have distinct names.
 */
function collectErrorsForModuleFilePath(
  errorsMap: ErrorsMap,
  fullPath: string,
): NavItemErrors | undefined {
  let ownCount = 0;
  let firstMessage: string | undefined;
  for (const keyString in errorsMap) {
    if (!keyString.startsWith(fullPath)) continue;
    const next = keyString.charAt(fullPath.length);
    // Only treat as belonging to this file if the source path either ends
    // exactly at this file or continues with `?` (module path query
    // separator). Bare prefixes like `/content/authors.val.ts` matching a
    // hypothetical sibling `/content/authors.val.ts.backup` are excluded.
    if (next !== "" && next !== "?") continue;
    const list = errorsMap[keyString as SourcePath];
    if (!list || list.length === 0) continue;
    ownCount += list.length;
    if (!firstMessage) firstMessage = list[0]?.message;
  }
  return ownCount > 0 ? { ownCount, firstMessage } : undefined;
}
