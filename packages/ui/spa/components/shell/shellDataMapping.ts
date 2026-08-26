import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { ExplorerItem, SitemapItem } from "../NavMenu/types";
import { ValEnrichedDeployment } from "../../utils/mergeCommitsAndDeployments";
import {
  ShellActivityEntry,
  ShellDataModule,
  ShellDeployment,
  ShellExternalPage,
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
    // The URL path is what identifies a page to a person, and it is unique
    // within a site map, so it doubles as the row's id.
    id: item.urlPath,
    name: item.name,
    urlPath: item.urlPath,
    errorCount: item.errors?.ownCount,
    hasDraft: item.moduleFilePath
      ? modulesWithDrafts.has(item.moduleFilePath)
      : undefined,
    children: item.children.map(toPage),
  });
  // The site map's root stands for the site itself rather than a page, so its
  // children are the top level the navigation shows.
  return root.children.map(toPage);
}

/**
 * The external router's record keys are the URLs themselves; there is no
 * separate label, so the host is what a person can recognise a row by.
 */
export function toExternalPages(
  record: Record<string, SourcePath> | null | undefined,
): ShellExternalPage[] {
  if (!record) return [];
  return Object.keys(record).map(
    (url): ShellExternalPage => ({
      id: url,
      name: hostLabel(url),
      url,
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
      name: item.name,
      moduleFilePath: item.fullPath,
      errorCount: item.errors?.ownCount,
      hasDraft: modulesWithDrafts.has(item.fullPath),
    });
  };
  walk(root);
  return modules;
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
): ShellActivityEntry[] {
  return patchSets.slice(0, ACTIVITY_LIMIT).map(
    (set, index): ShellActivityEntry => ({
      id: `${set.moduleFilePath}?${set.patchPath.join("/")}-${index}`,
      title: [fileLabel(set.moduleFilePath), ...set.patchPath].join(" › "),
      timestamp: set.lastUpdated,
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

export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
