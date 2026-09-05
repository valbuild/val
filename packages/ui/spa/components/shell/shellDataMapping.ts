import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import { ExplorerItem, SitemapItem } from "../NavMenu/types";
import { AvailableRoute } from "../NavMenu/NewPageForm";
import { routePatternToString } from "../NavMenu/SitemapItem";
import { ValEnrichedDeployment } from "../../utils/mergeCommitsAndDeployments";
import {
  ShellActivityEntry,
  ShellAdminLinks,
  ShellData,
  ShellDataModule,
  ShellDeployment,
  ShellDestination,
  ShellExternalPage,
  ShellMediaFile,
  ShellPage,
  ShellValidationError,
} from "./types";

/**
 * Pure translation from what the providers produce to what the shell renders.
 *
 * Split from `useShellData` so it can be tested: importing the hook pulls in
 * `ValProvider`, which pulls in the validation worker, which jest cannot load
 * (`import.meta`). This is also the half that can be wrong in a way the types
 * will not catch.
 */

/** The site map, as the shell's page tree. */
export function toShellPages(
  root: SitemapItem,
  modulesWithDrafts: ReadonlySet<string>,
): ShellPage[] {
  const toPage = (item: SitemapItem): ShellPage => ({
    // The row's id is the content it opens. That makes the id and the
    // navigation target the same string, so the app can resolve the route it
    // is on back to a row without a second lookup table. Folder rows have no
    // content of their own, so they fall back to their URL — they are never
    // selected, only expanded.
    id: item.sourcePath ?? item.urlPath,
    // The raw segment, which is what the site map shows elsewhere in the UI.
    // A slug is a slug: prettifying `why-we-built-val` only obscures which
    // URL the row is.
    name: item.name,
    urlPath: item.urlPath,
    sourcePath: item.sourcePath,
    errorCount: item.errors?.ownCount,
    hasDraft: item.moduleFilePath
      ? modulesWithDrafts.has(item.moduleFilePath)
      : undefined,
    // A row with a source path is a route Val resolves, which is exactly the
    // condition for the canvas: it can ask the running site what is on it.
    // A row without one is a path segment that only exists to hold children.
    isTracked: item.sourcePath !== undefined,
    children: item.children.map(toPage),
  });
  // The root is the site, and on most projects it is also the home page: an
  // `/app/page.val.ts` puts content on `/`. When it has a source path it is
  // therefore a row of its own, with everything else nested under it — drop it
  // and the home page becomes the one page the navigation cannot reach. Only a
  // project with no page at `/` has a root that is purely structural, and
  // there its children are the top level.
  return root.sourcePath !== undefined
    ? [toPage(root)]
    : root.children.map(toPage);
}

/**
 * The external router's record keys are the URLs themselves; there is no
 * separate label, so the host is what a person can recognise a row by.
 */
export function toExternalPages(
  record: Record<string, SourcePath> | null | undefined,
): ShellExternalPage[] {
  if (!record) return [];
  return Object.entries(record).map(
    ([url, sourcePath]): ShellExternalPage => ({
      // As with pages: the id is what the row opens.
      id: sourcePath,
      name: hostLabel(url),
      url,
      sourcePath,
    }),
  );
}

/** The explorer tree, flattened to the val files it contains. */
export function toDataModules(
  root: ExplorerItem,
  modulesWithDrafts: ReadonlySet<string>,
): ShellDataModule[] {
  const modules: ShellDataModule[] = [];
  const walk = (item: ExplorerItem) => {
    if (item.isDirectory) {
      item.children.forEach(walk);
      return;
    }
    modules.push({
      id: item.fullPath,
      // The tree's names are file names; the explorer shows them without the
      // val extension, and so does this row.
      name: fileLabel(item.name),
      moduleFilePath: item.fullPath,
      errorCount: item.errors?.ownCount,
      hasDraft: modulesWithDrafts.has(item.fullPath),
    });
  };
  walk(root);
  return modules;
}

/**
 * How many validation errors are in one module.
 *
 * Counted from the error map's keys rather than from the navigation tree,
 * because a destination that is NOT in that tree — settings has its own panel,
 * so it is taken out of the module tree — has no row to read a count off.
 */
export function countErrorsIn(
  errors: Record<SourcePath, unknown[]> | undefined,
  moduleFilePath: string,
): number | undefined {
  if (!errors) return undefined;
  let count = 0;
  for (const sourcePath of Object.keys(errors)) {
    // A source path is `<module file path>?<module path>`.
    if (sourcePath.split("?")[0] === moduleFilePath) {
      count += errors[sourcePath as SourcePath].length;
    }
  }
  return count;
}

/** Validation errors, grouped by the module they belong to. */
export function toValidationErrors(
  errors: Record<SourcePath, unknown[]> | undefined,
): ShellValidationError[] {
  if (!errors) return [];
  const byModule = new Map<string, number>();
  for (const sourcePath of Object.keys(errors)) {
    // A source path is `<module file path>?<module path>`; everything before
    // the separator is the file the error lives in.
    const [moduleFilePath] = sourcePath.split("?");
    byModule.set(moduleFilePath, (byModule.get(moduleFilePath) ?? 0) + 1);
  }
  return Array.from(byModule.entries())
    .map(
      ([moduleFilePath, count]): ShellValidationError => ({
        id: moduleFilePath,
        title: fileLabel(moduleFilePath),
        detail: moduleFilePath,
        count,
      }),
    )
    .sort((a, b) => b.count - a.count);
}

/** How many entries to show under Recent activity. */
const ACTIVITY_LIMIT = 8;

/**
 * Recent activity, from the patch sets.
 *
 * Patch sets are already newest first and already grouped by the thing that
 * changed, which is exactly what this list wants.
 */
export function toActivity(
  patchSets: Array<{
    moduleFilePath: ModuleFilePath;
    patchPath: string[];
    lastUpdated: string;
    lastUpdatedBy: string | null;
  }>,
  /**
   * A parameter rather than a call to `Date.now()`, so the result is a function
   * of its inputs and can be tested — the same reason `toDeployments` takes one.
   */
  now: number,
): ShellActivityEntry[] {
  return patchSets.slice(0, ACTIVITY_LIMIT).map(
    (set, index): ShellActivityEntry => ({
      // The index is load-bearing: two patch sets can share a module and a path,
      // and React needs them apart. `sourcePath` is the one that means something.
      id: `${set.moduleFilePath}?${set.patchPath.join("/")}-${index}`,
      /**
       * Where the change was, as a real source path.
       *
       * Built with `patchPathToModulePath`, which is the only thing that knows
       * the grammar — string keys are JSON-quoted, array indices are bare — so
       * `["items", "0", "title"]` becomes `"items".0."title"` and not something
       * that looks close enough to work and then does not resolve.
       */
      sourcePath: Internal.joinModuleFilePathAndModulePath(
        set.moduleFilePath,
        Internal.patchPathToModulePath(set.patchPath),
      ),
      title: [fileLabel(set.moduleFilePath), ...set.patchPath].join(" › "),
      // Relative, because this is a "what have I been doing" list and an ISO
      // timestamp is not an answer to that. It was rendered raw.
      timestamp: formatRelativeTime(set.lastUpdated, now),
      author: set.lastUpdatedBy ?? undefined,
    }),
  );
}

/** How many publishes the deployment feed keeps. */
const DEPLOYMENT_LIMIT = 10;

/**
 * Publishes, newest first, as the status bar's deploy feed.
 *
 * `observedCommitShas` is Val's own answer to a question the deployment API
 * cannot answer: a build can go green before the commit is actually being
 * served, so "live" means Val has seen the site answer with that commit.
 */
export function toDeployments(
  deployments: ValEnrichedDeployment[],
  observedCommitShas: ReadonlySet<string>,
  profilesByAuthorId: Record<string, { fullName: string }>,
  now: number,
): ShellDeployment[] {
  return deployments.slice(0, DEPLOYMENT_LIMIT).map(
    (deployment): ShellDeployment => ({
      commitSha: deployment.commitSha,
      state: deployment.deploymentState,
      message: deployment.commitMessage,
      author: deployment.creator
        ? profilesByAuthorId[deployment.creator]?.fullName
        : undefined,
      timestamp: formatRelativeTime(deployment.updatedAt, now),
      updatedAt: deployment.updatedAt,
      isLive: observedCommitShas.has(deployment.commitSha),
    }),
  );
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * An ISO timestamp as the relative string the shell's lists render.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the result is a
 * function of its inputs and can be tested.
 */
export function formatRelativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    // Better to show the raw value than to claim a time we could not read.
    return iso;
  }
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 0) {
    return "just now";
  }
  if (seconds < 45) {
    return "just now";
  }
  if (seconds < HOUR) {
    return plural(Math.round(seconds / MINUTE), "minute");
  }
  if (seconds < DAY) {
    return plural(Math.round(seconds / HOUR), "hour");
  }
  return plural(Math.round(seconds / DAY), "day");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/**
 * A gallery's record, as the files in it.
 *
 * `undefined` while the record is still loading, so the panel can tell "not
 * fetched yet" from "no files" — one is a spinner and the other is an empty
 * state, and showing the wrong one is how a slow load reads as an empty
 * gallery.
 *
 * Sorted by file name rather than by full path: two directories deep, the paths
 * share a prefix and the name is the part anyone is scanning for.
 */
export function toMediaFiles(
  record: Record<string, SourcePath> | null | undefined,
): ShellMediaFile[] | undefined {
  if (!record) return undefined;
  return Object.entries(record)
    .map(([ref, sourcePath]): ShellMediaFile => ({ ref, sourcePath }))
    .sort((a, b) => fileName(a.ref).localeCompare(fileName(b.ref)));
}

/** `/public/val/images/logo_a1b2c.png` -> `logo_a1b2c.png` */
export function fileName(ref: string): string {
  const segments = ref.split("/");
  return segments[segments.length - 1] || ref;
}

export function countKeys(
  record: Record<string, SourcePath> | null | undefined,
) {
  return record ? Object.keys(record).length : 0;
}

/** `/public/val/images` -> `images` */
export function directoryName(directory: string): string {
  const segments = directory.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? directory;
}

/** `/content/products.val.ts` -> `products` */
export function fileLabel(moduleFilePath: string): string {
  const file = moduleFilePath.split("/").pop() ?? moduleFilePath;
  return file.replace(/\.val\.(ts|js)$/, "");
}

/** `https://instagram.com/valbuild` -> `instagram.com/valbuild` */
export function hostLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    // Not every entry is guaranteed to parse; showing the raw key beats
    // showing nothing.
    return url;
  }
}

/**
 * The project's pages in Val Build's admin app.
 *
 * `config.project` is `"<org>/<project>"` — the format `val connect` insists
 * on — so anything else has no page to open: a project that was never
 * connected has no `project` at all, and a malformed one would only produce a
 * link to a 404. Both return `undefined`, which is what hides the link and the
 * settings buttons rather than offering a way out that goes nowhere.
 *
 * The member list is reached through `/manage-members/<org>`, which the admin
 * app keeps for exactly this — it redirects to wherever the org's members
 * currently live, so Val does not have to track that page moving.
 */
export function toAdminLinks(
  config: { project?: string; appHost?: string } | undefined,
): ShellAdminLinks | undefined {
  if (!config?.project || !config.appHost) {
    return undefined;
  }
  const parts = config.project.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return undefined;
  }
  const [org, project] = parts;
  const host = config.appHost.replace(/\/+$/, "");
  return {
    project: `${host}/~/${encodeURIComponent(org)}/${encodeURIComponent(project)}`,
    members: `${host}/manage-members/${encodeURIComponent(org)}`,
  };
}

/**
 * The destinations a project actually has something behind, in rail order.
 *
 * A project is not obliged to use all of Val: a marketing site is routes and
 * images with no loose content files; a design-token project is content files
 * and nothing else. A rail icon that opens a panel saying "nothing here" reads
 * as a broken Val rather than as a part of Val this project does not use, so
 * the icon goes instead of the panel being empty.
 *
 * Pages hangs off `hasRouters` rather than off `pages` being non-empty, because
 * a router with no entries yet is a site map to add the first page to.
 *
 * Media, Data and Settings hang off their own data, which is already exactly
 * the right question. `media` is the `s.images()`/`s.files()` modules, and an
 * empty gallery still lists as a gallery — so an empty `media` means no gallery
 * module exists. `settings` is the project's `s.settings()` module, and an empty
 * settings module (`{}`, which is the normal starting point) still resolves —
 * so its absence means the project has no settings module, or none it can use.
 * `data` is what is left after the routers, the galleries and settings have been
 * taken out of the module tree, so "every module is a router, a gallery or
 * settings" and "`data` is empty" are the same statement.
 *
 * Everything is on offer while the navigation is still loading: the panels have
 * loading states of their own, and a rail that grows icons as data arrives is
 * worse than one that starts full.
 */
export function availableDestinations(
  data: Pick<ShellData, "hasRouters" | "media" | "settings" | "data">,
  isLoading: boolean,
): ShellDestination[] {
  // Settings is NOT offered while loading, unlike the other three: it is the
  // only one whose icon sits on its own at the foot of the rail, so a cog that
  // appears and then goes reads as something that broke rather than as data
  // arriving. A project without `s.settings()` never shows it at all.
  if (isLoading) return ["pages", "media", "data"];
  const available: ShellDestination[] = [];
  if (data.hasRouters) available.push("pages");
  if (data.media.length > 0) available.push("media");
  if (data.data.length > 0) available.push("data");
  if (data.settings) available.push("settings");
  return available;
}

/**
 * Where a new page can go.
 *
 * `NewPageForm` already knows how to build a URL from a route pattern — static
 * segments as chips, dynamic ones as inputs, catch-alls, optional segments that
 * mean the base route, the schema author's own description of a key — so this
 * only has to find the routes to hand it. A route accepts children when its
 * pattern has a dynamic segment in it, a flag set upstream by
 * `transformSitemapNode`.
 *
 * `existingUrls` is every URL the tree currently has, which is what lets the
 * form say "a page with this path already exists" — including a collision with a
 * page under a different route, which a route's own sibling list would miss.
 */
export function collectNewPageRoutes(root: SitemapItem): {
  routes: AvailableRoute[];
  existingUrls: string[];
} {
  const routes = new Map<string, AvailableRoute>();
  const existingUrls: string[] = [];

  const walk = (item: SitemapItem) => {
    if (item.sourcePath || item.children.length === 0) {
      existingUrls.push(item.urlPath);
    }
    if (item.canAddChild && item.moduleFilePath && item.routePattern) {
      const patternString = routePatternToString(item.routePattern);
      const key = `${item.moduleFilePath}::${patternString}`;
      if (!routes.has(key)) {
        routes.set(key, {
          moduleFilePath: item.moduleFilePath,
          routePattern: item.routePattern,
          patternString,
          // Filled in below, once every URL is known.
          existingKeys: [],
          keyDescription: item.keyDescription,
        });
      }
    }
    for (const child of item.children) {
      walk(child);
    }
  };
  walk(root);

  return {
    routes: Array.from(routes.values()).map(
      (route): AvailableRoute => ({ ...route, existingKeys: existingUrls }),
    ),
    existingUrls,
  };
}
