import {
  Internal,
  type Json,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import {
  childSource,
  isJsonObject,
  localeMeantBy,
  localeParamOfRouteKey,
  localeScopeAt,
} from "./localeAt";

/**
 * Where an editor goes when the Studio's language changes under them.
 *
 * - `stay`: the path is in that language, or in none.
 * - `path`: the same entry in that language (`counterpart`), or the nearest
 *   parent that is not in another language (`parent`).
 * - `root`: neither exists, so the editor goes to that language's start —
 *   which only the Studio can say, since it is a question about the whole
 *   site's routes rather than about this module.
 */
export type LocaleRelocation =
  | { type: "stay" }
  | { type: "path"; path: SourcePath; reason: "counterpart" | "parent" }
  | { type: "root" };

/**
 * Where to move a path to when the Studio is switched to `locale`.
 *
 * The rule, in the order it is tried:
 *
 * 1. **The same entry in `locale`, where Val KNOWS it.** That is two cases:
 *    a locale-keyed record, where the counterpart of `"en-US"` is the
 *    `"nb-NO"` key of the same record; and a router whose URLs name their
 *    language, where `/about` and `/nb/about` differ only in it. Only a key
 *    that exists is taken, and the rest of the path is kept as far as it
 *    still exists, so an editor on a field lands on that field.
 * 2. **Otherwise the nearest parent that is not in another language.** An
 *    English post in a list of posts gives the list, now showing Norwegian.
 * 3. **Otherwise the language's start**, which is `root`. That is where an
 *    object at the module root opened the scope (the whole module is in
 *    another language), and where the parent would be a router: a list of
 *    pages is not a page, and the Pages tree is how an editor sees one.
 *
 * Never a guess. Two pages whose URLs differ in more than the language — a
 * Norwegian slug for a Norwegian page — are not known to be translations of
 * each other, so that is `root` rather than whichever page looks closest.
 */
export function relocateForLocale(
  path: SourcePath,
  locale: string,
  schema: SerializedSchema,
  source: Json,
  available: readonly string[],
): LocaleRelocation {
  const scope = localeScopeAt(path, schema, source, available);
  if (scope === null || scope.locale === locale) {
    return { type: "stay" };
  }
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const segments = modulePath ? Internal.splitModulePath(modulePath) : [];
  const at = (parts: string[]): SourcePath =>
    Internal.joinModuleFilePathAndModulePath(
      moduleFilePath,
      Internal.patchPathToModulePath(parts),
    );
  const prefix = segments.slice(0, scope.depth);
  const rest = segments.slice(scope.depth + 1);

  if (scope.kind === "record-key") {
    const record = sourceAt(source, prefix);
    const key = isJsonObject(record)
      ? Object.keys(record).find(
          (candidate) =>
            localeMeantBy(scope.keySchema, candidate, available) === locale,
        )
      : undefined;
    if (key !== undefined) {
      return {
        type: "path",
        path: at(existingPart(source, [...prefix, key], rest)),
        reason: "counterpart",
      };
    }
    return { type: "path", path: at(prefix), reason: "parent" };
  }

  if (scope.kind === "route-key") {
    const router = sourceAt(source, prefix);
    const current = localeParamOfRouteKey(
      scope.router,
      moduleFilePath,
      segments[scope.depth],
    );
    if (isJsonObject(router) && current !== null) {
      const key = Object.keys(router).find((candidate) => {
        const other = localeParamOfRouteKey(
          scope.router,
          moduleFilePath,
          candidate,
        );
        return (
          other !== null &&
          localeMeantBy(other.schema, other.value, available) === locale &&
          sameRouteExcept(current.values, other.values, current.name)
        );
      });
      if (key !== undefined) {
        return {
          type: "path",
          path: at(existingPart(source, [...prefix, key], rest)),
          reason: "counterpart",
        };
      }
    }
    return { type: "root" };
  }

  // A locale FIELD opened the scope, on the node `depth` segments down.
  if (scope.depth === 0) {
    return { type: "root" };
  }
  const parent = segments.slice(0, scope.depth - 1);
  if (
    parent.length === 0 &&
    schema.type === "record" &&
    schema.router !== undefined
  ) {
    return { type: "root" };
  }
  return { type: "path", path: at(parent), reason: "parent" };
}

/** The source at `parts` below `source`, or `null` where it runs out. */
function sourceAt(source: Json, parts: string[]): Json {
  let current = source;
  for (const part of parts) {
    current = childSource(current, part);
  }
  return current;
}

/**
 * `base`, followed by as much of `rest` as the source still has.
 *
 * The counterpart of a field is the same field in the other language's entry,
 * but that entry can be `null` — declared and not yet written — or shorter (a
 * list with fewer items). Landing on the entry then is the right answer: it is
 * the translation the editor is about to write.
 */
function existingPart(source: Json, base: string[], rest: string[]): string[] {
  const parts = [...base];
  let current = sourceAt(source, base);
  for (const part of rest) {
    const next = childSource(current, part);
    if (next === null) {
      break;
    }
    parts.push(part);
    current = next;
  }
  return parts;
}

/** Whether two routes' parameters agree on everything but `ignore`. */
function sameRouteExcept(
  a: Record<string, string | null>,
  b: Record<string, string | null>,
  ignore: string,
): boolean {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const name of names) {
    if (name !== ignore && (a[name] ?? null) !== (b[name] ?? null)) {
      return false;
    }
  }
  return true;
}
