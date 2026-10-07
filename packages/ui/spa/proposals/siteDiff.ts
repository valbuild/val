import type { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import {
  insertIntoTree,
  type ChangeTreeNode,
  type ChangeType,
} from "../utils/computeChangedSourcePaths";

/**
 * What a proposal changes, as the compare dialog lists it: the site's Source
 * against the proposal's, saved and unsaved alike. valbuild/home
 * `docs/proposals.md`, "Compare with the site".
 *
 * From the SOURCE, not from patches, and that is the whole reason this exists:
 * the patch-set view is built from patches the Studio holds, and a proposal's
 * saved changes are not among them -- they are in its snapshot, which is the
 * Studio's base there. What Publish would publish is the difference between
 * the site and the snapshot plus what is unsaved, so that is what is diffed.
 *
 * Walked by the SCHEMA, down through objects, records and arrays, so a row is
 * a field an editor knows -- never a node in the middle of a rich text value,
 * which has no schema of its own to render with. Anything else that differs
 * is one changed field. An array is walked item by item while it keeps its
 * length, and while only its end grows or shrinks; otherwise it is one change,
 * because which item moved where is not something a diff of two values can
 * honestly say.
 */
export type SiteDiffModule = {
  moduleFilePath: ModuleFilePath;
  /** The site's Source for it. */
  site: unknown;
  /** The proposal's, as the Studio holds it now. */
  now: unknown;
  schema: SerializedSchema | undefined;
};

type Change = { path: string[]; changeType: ChangeType };

export function siteChangeTrees(modules: SiteDiffModule[]): ChangeTreeNode[] {
  const trees: ChangeTreeNode[] = [];
  for (const { moduleFilePath, site, now, schema } of modules) {
    const changes: Change[] = [];
    walk(schema, site, now, [], changes);
    if (changes.length === 0) continue;
    const root: ChangeTreeNode = {
      sourcePath: moduleFilePath,
      lastUpdated: "",
      isCommitted: false,
      children: [],
    };
    for (const change of changes) {
      // No patches, no authors: a saved change is the proposal's, not anyone's
      // patch the Studio could name or undo.
      insertIntoTree(
        root,
        moduleFilePath,
        change.path,
        change.changeType,
        [],
        [],
        "",
        null,
        {},
        false,
      );
    }
    trees.push(root);
  }
  return trees;
}

function walk(
  schema: SerializedSchema | undefined,
  site: unknown,
  now: unknown,
  path: string[],
  out: Change[],
): void {
  if (sameJson(site, now)) return;
  if (schema?.type === "object" && isObject(site) && isObject(now)) {
    for (const [key, item] of Object.entries(schema.items)) {
      walk(item, site[key], now[key], [...path, key], out);
    }
    return;
  }
  if (schema?.type === "record" && isObject(site) && isObject(now)) {
    for (const key of unionKeys(site, now)) {
      const inSite = Object.prototype.hasOwnProperty.call(site, key);
      const inNow = Object.prototype.hasOwnProperty.call(now, key);
      if (inSite && inNow) {
        walk(schema.item, site[key], now[key], [...path, key], out);
      } else {
        out.push({
          path: [...path, key],
          changeType: inNow ? "added" : "removed",
        });
      }
    }
    return;
  }
  if (schema?.type === "array" && Array.isArray(site) && Array.isArray(now)) {
    const shared = Math.min(site.length, now.length);
    const prefixSame = site
      .slice(0, shared)
      .every((item, i) => sameJson(item, now[i]));
    if (site.length === now.length || prefixSame) {
      for (let i = 0; i < shared; i++) {
        walk(schema.item, site[i], now[i], [...path, String(i)], out);
      }
      for (let i = shared; i < now.length; i++) {
        out.push({ path: [...path, String(i)], changeType: "added" });
      }
      for (let i = shared; i < site.length; i++) {
        out.push({ path: [...path, String(i)], changeType: "removed" });
      }
      return;
    }
  }
  out.push({ path, changeType: "field-change" });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unionKeys(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])];
}

/** Structural equality of two JSON values; key order does not matter. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJson(item, b[i]))
    );
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(b, key) &&
          sameJson(a[key], b[key]),
      )
    );
  }
  return false;
}
