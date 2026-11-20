import { Internal, type ModuleFilePath, type SourcePath } from "@valbuild/core";
import { z } from "zod";

/**
 * Content analytics for one module, as Val Build answers it
 * (`GET /v1/studio/orgs/:org/projects/:project/analytics/module`): every
 * content path of the module counted in the range -- in how many page views
 * it was on the page (`rendered`), and in how many it was on screen
 * (`viewed`). Reached through this app's server, `/api/val/admin/proxy`,
 * which attaches the editor's Val Build credential.
 */

/** In how many page views something was on the page, and on screen. */
export type ContentViews = { rendered: number; viewed: number };

export type ModuleAnalytics = {
  /** The range, days in UTC, both ends included. */
  from: string;
  to: string;
  /** Each counted path, and every path above it, by `pathKey`. */
  byKey: Map<string, ContentViews>;
  /** What is directly inside each of those, by the parent's `pathKey`. */
  children: Map<string, Array<{ path: SourcePath } & ContentViews>>;
};

const Count = z.number().int().nonnegative();

const Answer = z.object({
  from: z.string(),
  to: z.string(),
  since: z.string().nullable(),
  module: z.string(),
  paths: z.array(
    z.object({ path: z.string(), rendered: Count, viewed: Count }),
  ),
});

/**
 * The module's numbers, or null where there is nothing to show: analytics
 * is off for the project (`since` is null), or nothing in the module has been
 * counted.
 */
export function moduleAnalyticsOf(json: unknown): ModuleAnalytics | null {
  const parsed = Answer.safeParse(json);
  if (!parsed.success || parsed.data.since === null) {
    return null;
  }
  const { byKey, children } = indexContentViews(parsed.data.paths);
  return byKey.size === 0
    ? null
    : { from: parsed.data.from, to: parsed.data.to, byKey, children };
}

/**
 * The same path, however it was written: a stega tag and the Studio can
 * quote a numeric record key differently, and both mean the same segments.
 */
export function pathKey(path: SourcePath | ModuleFilePath): string {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const parts = modulePath ? Internal.splitModulePath(modulePath) : [];
  return JSON.stringify([moduleFilePath, ...parts]);
}

/** A path as the script sends it: a module file, maybe with `?p=` and a path in it. */
function isSourcePath(path: string): path is SourcePath {
  return path.startsWith("/");
}

/**
 * Every counted path, and each path above it: a list item, an object, the
 * module. A page view has no "item": the script counts the elements on the
 * page, and those carry the paths of what they show. So something holding
 * several counted paths is given the most any of them got -- in as many page
 * views as that, at least, it was on the page, or on screen. Adding them
 * would count a page view once per field it showed.
 */
export function indexContentViews(
  paths: ReadonlyArray<{ path: string } & ContentViews>,
): Pick<ModuleAnalytics, "byKey" | "children"> {
  const found = new Map<
    string,
    { moduleFilePath: ModuleFilePath; parts: string[] } & ContentViews
  >();
  for (const { path, rendered, viewed } of paths) {
    // A path the script sent that does not parse names nothing here.
    if (!isSourcePath(path)) continue;
    let parts: string[];
    let moduleFilePath: ModuleFilePath;
    try {
      const [file, modulePath] =
        Internal.splitModuleFilePathAndModulePath(path);
      moduleFilePath = file;
      parts = modulePath ? Internal.splitModulePath(modulePath) : [];
    } catch {
      continue;
    }
    for (let depth = 0; depth <= parts.length; depth++) {
      const at = parts.slice(0, depth);
      const key = JSON.stringify([moduleFilePath, ...at]);
      const before = found.get(key);
      found.set(key, {
        moduleFilePath,
        parts: at,
        rendered: Math.max(before?.rendered ?? 0, rendered),
        viewed: Math.max(before?.viewed ?? 0, viewed),
      });
    }
  }
  const byKey = new Map<string, ContentViews>();
  const children = new Map<
    string,
    Array<{ path: SourcePath } & ContentViews>
  >();
  for (const [key, { moduleFilePath, parts, rendered, viewed }] of found) {
    byKey.set(key, { rendered, viewed });
    if (parts.length === 0) continue;
    const parentKey = JSON.stringify([moduleFilePath, ...parts.slice(0, -1)]);
    const siblings = children.get(parentKey) ?? [];
    siblings.push({
      path: Internal.joinModuleFilePathAndModulePath(
        moduleFilePath,
        Internal.patchPathToModulePath(parts),
      ),
      rendered,
      viewed,
    });
    children.set(parentKey, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => b.viewed - a.viewed || b.rendered - a.rendered);
  }
  return { byKey, children };
}

/** "1,234". */
export function wholeNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** "980", "1.2k", "34k", "1.2M": short enough for a badge. */
export function compactNumber(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) {
    return n < 10_000
      ? `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`
      : `${Math.round(n / 1_000)}k`;
  }
  return n < 10_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : `${Math.round(n / 1_000_000)}M`;
}

/** "Last 30 days", or "12 Oct – 20 Oct" for any other range. */
export function rangeText(
  range: { from: string; to: string },
  today: string,
): string {
  const days =
    Math.round(
      (Date.parse(`${range.to}T00:00:00Z`) -
        Date.parse(`${range.from}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  if (range.to === today) {
    return `the last ${days} ${days === 1 ? "day" : "days"}`;
  }
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return `${day(range.from)} – ${day(range.to)}`;
}

/**
 * What a badge's tooltip says: on screen in how many page views, out of how
 * many it was on the page in, over which days.
 */
export function viewsText(
  views: ContentViews,
  range: { from: string; to: string },
  today: string,
): string {
  const share =
    views.rendered === 0
      ? ""
      : ` (${Math.round((views.viewed / views.rendered) * 100)}%)`;
  return `Seen in ${wholeNumber(views.viewed)} of the ${wholeNumber(
    views.rendered,
  )} page ${views.rendered === 1 ? "view" : "views"} it was on${share}, ${rangeText(range, today)}.`;
}
