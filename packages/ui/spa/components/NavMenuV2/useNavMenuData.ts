import { useMemo } from "react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
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
import { NavMenuData, SitemapItem, ExplorerItem } from "./types";
import { PathNode } from "../../utils/pathTree";
import { Remote } from "../../utils/Remote";

/**
 * Transforms a SitemapNode (from shared/internal) to our SitemapItem type.
 */
function transformSitemapNode(node: SitemapNode | PageNode): SitemapItem {
  const canAddChild = !!node.pattern?.includes("[");
  const routePattern =
    canAddChild && node.pattern ? parseRoutePattern(node.pattern) : undefined;

  // Get existing keys from children for validation in add form
  const existingKeys = canAddChild
    ? node.children.map((child) => "/" + child.name)
    : undefined;

  return {
    name: node.name,
    urlPath: node.pattern || "/",
    sourcePath: node.sourcePath as SourcePath | undefined,
    moduleFilePath: node.moduleFilePath as ModuleFilePath | undefined,
    canAddChild,
    routePattern,
    existingKeys,
    children: node.children.map(transformSitemapNode),
  };
}

/**
 * Transforms a PathNode to our ExplorerItem type.
 */
function transformPathNode(node: PathNode): ExplorerItem {
  return {
    name: node.name,
    fullPath: node.fullPath,
    isDirectory: !!node.isDirectory,
    children: node.children.map(transformPathNode),
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

  return useMemo((): Remote<NavMenuData> => {
    if (trees.status !== "success") {
      return trees;
    }

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
              shallowSource[path]
            );
            paths.push({
              urlPath: path,
              moduleFilePath,
            });
          }
        }
        const sitemapTree = getNextAppRouterSitemapTree(srcFolder.data, paths);
        console.log("sitemapTree", sitemapTree);
        data.sitemap = transformSitemapNode(sitemapTree);
      } else if (
        srcFolder.status === "loading" ||
        shallowModules.status === "loading"
      ) {
        return { status: "loading" };
      }
    }

    // Transform explorer tree if available
    if (trees.data.root && trees.data.root.children.length > 0) {
      data.explorer = transformPathNode(trees.data.root);
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
  }, [trees, sitemapPaths, srcFolder, shallowModules]);
}
