import { useMemo } from "react";
import {
  Internal,
  isPageRouter,
  ModuleFilePath,
  ReifiedPreview,
  resolveSettingsModule,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { useTrees } from "../useTrees";
import {
  useShallowModulesAtPaths,
  usePageRouterSrcFolder,
} from "../ValProvider";
import { useAllPreviews, useSchemas } from "../ValFieldProvider";
import { usePreviewDemand } from "../usePreviewDemand";
import {
  getPageRouterSitemapTree,
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
import { resolveRefPreview } from "../useRefPreview";

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
  previews?: Record<ModuleFilePath, ReifiedPreview | null>,
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

  /*
   * What a `.preview(...)` calls this page.
   *
   * A page is an entry of a router RECORD, so its preview is in that module's
   * reified rows rather than at its own path — `resolveRefPreview` is the same
   * lookup `useRefPreview` does, reused rather than re-derived (a route key is
   * a quoted path segment, and getting the unquoting wrong here is how the
   * lookup silently missed everywhere before).
   */
  const pageModuleFilePath = node.moduleFilePath as ModuleFilePath | undefined;
  const pageSchema = pageModuleFilePath
    ? schemas?.[pageModuleFilePath]
    : undefined;
  const title =
    sourcePath && pageModuleFilePath && pageSchema
      ? resolveRefPreview(
          sourcePath,
          pageModuleFilePath as unknown as SourcePath,
          pageSchema,
          previews?.[pageModuleFilePath]?.[pageModuleFilePath],
        )?.title?.trim() || undefined
      : undefined;

  // The URL this row resolves to, which is what navigation, key creation and
  // the row's own label all need. `pattern` is the route *pattern*
  // (`/blogs/[blog]`), shared by every sibling under a dynamic segment, so
  // taking it would give two blog posts the same URL. `fullPath` is the
  // resolved one; only a folder row that is not itself a page lacks it, and
  // there the pattern is all there is.
  const resolvedUrlPath =
    (node.type === "leaf" ? node.fullPath : node.page?.fullPath) ||
    node.pattern ||
    "/";

  return {
    name: node.name,
    urlPath: resolvedUrlPath,
    sourcePath,
    moduleFilePath,
    canAddChild,
    routePattern,
    existingKeys,
    keyDescription,
    title,
    errors,
    children: node.children.map((child) =>
      transformSitemapNode(child, navErrors, schemas, previews),
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
  /*
   * The modules of every PAGE router, whichever framework declared them.
   *
   * One sitemap rather than one per router id: the tree is made of URL paths
   * of this site, and a project has one of those. `isPageRouter` is what
   * decides which routers those are — the same answer `getSourcePathFromRoute`
   * gives, so the menu and click-to-edit cannot disagree.
   */
  const sitemapPaths = useMemo(() => {
    if (trees.status !== "success") return [];
    return Object.keys(trees.data.routers)
      .filter(isPageRouter)
      .flatMap((routerId) => trees.data.routers[routerId] ?? []);
  }, [trees]);

  const shallowModules = useShallowModulesAtPaths(sitemapPaths, "record");
  const srcFolder = usePageRouterSrcFolder();
  const validationErrors = useAllValidationErrors();
  const schemas = useSchemas();
  /*
   * The sitemap NAMES its rows, so it has to ask for the previews that name
   * them.
   *
   * `useShallowModulesAtPaths` above reads sources without subscribing, and a
   * subscription is the only thing the preview store treats as demand — so
   * without this the titles appeared for whichever router module the editor
   * happened to be in and nowhere else. One listener per router module (there
   * are rarely more than a handful), never one per page.
   */
  usePreviewDemand(sitemapPaths);
  const previews = useAllPreviews();

  return useMemo((): Remote<NavMenuData> => {
    if (trees.status !== "success") {
      return trees;
    }

    // Indexed ONCE per render: the trees used to scan the whole error map for
    // every row, which is O(rows x errors) on every validation update.
    const navErrors = indexNavErrors(validationErrors ?? {});
    // Every router the project declares, of whatever kind: a project with only
    // external URLs still has pages to show, so the answer is about routers
    // existing rather than about the app router specifically.
    const routerIds = Object.keys(trees.data.routers).filter(
      (routerId) => (trees.data.routers[routerId] ?? []).length > 0,
    );
    const data: NavMenuData = { hasRouters: routerIds.length > 0 };

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
        const sitemapTree = getPageRouterSitemapTree(srcFolder.data, paths);
        data.sitemap = transformSitemapNode(
          sitemapTree,
          navErrors,
          schemas.status === "success" ? schemas.data : undefined,
          previews,
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
    // The settings module, if the project has exactly one usable one. A second
    // one, or one in a subdirectory, resolves to nothing — the module errors
    // say why, and offering a destination that cannot say WHICH settings it is
    // showing would hide the question rather than raise it.
    const settingsModule =
      schemas.status === "success"
        ? resolveSettingsModule(schemas.data).moduleFilePath
        : null;
    if (settingsModule) {
      data.settings = { moduleFilePath: settingsModule };
    }
    // Galleries and settings have destinations of their own, so they are taken
    // out of the module tree: Data is what is LEFT.
    const excludedPaths: ReadonlySet<string> = new Set(
      media
        .map((m) => m.moduleFilePath as string)
        .concat(settingsModule ? [settingsModule as string] : []),
    );

    // Transform explorer tree if available
    if (trees.data.root && trees.data.root.children.length > 0) {
      const explorer = transformPathNode(
        trees.data.root,
        navErrors,
        excludedPaths,
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
    // Demand resolves ASYNCHRONOUSLY: the listeners registered above make the
    // previews appear some time after the first render, so leaving this out
    // left the sitemap on its pre-preview answer until an unrelated
    // dependency happened to change.
    previews,
  ]);
}
