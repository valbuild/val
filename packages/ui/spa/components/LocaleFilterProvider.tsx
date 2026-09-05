import {
  localeOfValue,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import { createContext, ReactNode, useContext, useMemo } from "react";
import { useProjectLocales } from "../hooks/useProjectLocales";
import { useSchemaAtPath, useShallowSourceAtPath } from "./ValFieldProvider";
import { sourcePathOfItem } from "../utils/sourcePathOfItem";

/**
 * The language the studio is currently showing, for everything below the shell.
 *
 * A context rather than a prop because the two ends are far apart: the picker is
 * in the chrome and the thing it hides is a row in a field, with the whole
 * editor in between.
 */
const LocaleFilterContext = createContext<string | null>(null);

export function LocaleFilterProvider({
  locale,
  children,
}: {
  locale: string | null;
  children: ReactNode;
}) {
  return (
    <LocaleFilterContext.Provider value={locale}>
      {children}
    </LocaleFilterContext.Provider>
  );
}

/** The language being shown, or `null` for all of them. */
export function useLocaleFilter(): string | null {
  return useContext(LocaleFilterContext);
}

/**
 * A row, hidden when the locale filter says another language.
 *
 * Wraps the row rather than filtering the list, because the answer needs the
 * row's own content: an object says which language it is in through its `locale`
 * FIELD, and a list has only paths. Reading that is a hook, and a hook cannot be
 * called from inside a `.map()` — so the read happens where the row is, which is
 * a component.
 *
 * The locale-keyed record case does not come through here: there the key is the
 * language, so the list filters its keys and never renders the row at all. See
 * `RecordFields`.
 *
 * Renders `null` when hidden, which is what the surrounding lists already do for
 * a hidden item schema.
 */
export function LocaleFiltered({
  path,
  children,
}: {
  path: SourcePath;
  children: ReactNode;
}) {
  const filter = useLocaleFilter();
  const projectLocales = useProjectLocales();
  const schemaAtPath = useSchemaAtPath(path);
  const schema = "data" in schemaAtPath ? schemaAtPath.data : undefined;
  const localeField = schema === undefined ? null : localeFieldNameOf(schema);
  // A path that cannot exist rather than `undefined`: the hook below is a hook,
  // so it runs whether or not this row has a locale field. It resolves to
  // nothing, which is the answer for every row that has none.
  const localePath: SourcePath =
    localeField === null
      ? ("" as SourcePath)
      : sourcePathOfItem(path, localeField);
  const localeSource = useShallowSourceAtPath(localePath, "locale");
  if (filter === null || !projectLocales.includes(filter)) {
    return <>{children}</>;
  }
  if (localeField === null) {
    // No scope here, so nothing to hide: content in no language is always shown.
    return <>{children}</>;
  }
  const value = "data" in localeSource ? localeSource.data : undefined;
  if (typeof value !== "string") {
    // Not filled in, or not loaded yet. Both stay listed — hiding a field
    // someone has to fill in to un-hide it is the worse mistake, and a row that
    // vanishes as its content arrives is the other one.
    return <>{children}</>;
  }
  const locale = localeOfValue(
    value,
    projectLocales,
    localeFieldAliases(schema, localeField),
  );
  if (locale !== null && locale !== filter) {
    return null;
  }
  return <>{children}</>;
}

/** The name of an object schema's `s.locale()` field, if it has one. */
function localeFieldNameOf(schema: SerializedSchema): string | null {
  if (schema.type !== "object") {
    return null;
  }
  for (const [field, item] of Object.entries(schema.items)) {
    if (item.type === "locale") {
      return field;
    }
  }
  return null;
}

/** That field's alias table, so a stored `no` reads back as `nb-NO`. */
function localeFieldAliases(
  schema: SerializedSchema | undefined,
  field: string,
): Record<string, string[]> | undefined {
  if (schema?.type !== "object") {
    return undefined;
  }
  const item = schema.items[field];
  return item?.type === "locale" ? item.aliases : undefined;
}

/** A node a list is about to draw, as much of it as the list already has. */
export type LocaleFilterNode = {
  /** The key this node sits at, where its parent is a record. */
  key?: string;
  /** The parent record's key schema, where there is one. */
  keySchema?: SerializedSchema;
  /** This node's own schema, for the `locale`-field case. */
  schema?: SerializedSchema;
  /** This node's own source, read only when its schema has a locale field. */
  source?: unknown;
};

/**
 * Whether a node should be LISTED under the current filter.
 *
 * The rule, and the whole reason this can be a cheap per-node check: only a node
 * that OPENS a locale scope is ever filtered. Content inside a scope is reachable
 * only through the node that opened it, so hiding that node takes its subtree
 * with it — there is nothing to re-check further down.
 *
 * Everything that opens no scope is shown, always. In most projects that is most
 * of the content, and it is the "and the content that is unspecified" half of the
 * rule: the filter narrows a translated section, it does not empty the studio.
 *
 * Hiding is never blocking. A link to a Norwegian page opens it while the filter
 * says English — the filter changes what is listed, not what exists.
 */
export function useLocaleFilterPredicate(): (
  node: LocaleFilterNode,
) => boolean {
  const filter = useLocaleFilter();
  const projectLocales = useProjectLocales();
  return useMemo<(node: LocaleFilterNode) => boolean>(() => {
    if (filter === null || !projectLocales.includes(filter)) {
      // No filter, or one naming a language this project does not have — a
      // hand-edited link, or a language since removed. Both mean "show
      // everything" rather than "show nothing".
      return () => true;
    }
    return (node) => {
      const opened = localeScopeOf(node, projectLocales);
      return opened === null || opened === filter;
    };
  }, [filter, projectLocales]);
}

/**
 * The language a node's own scope is in, or `null` where it opens none.
 *
 * Two of the three ways a scope opens are answerable from what a list already
 * has to hand: an entry of a locale-keyed record (the KEY is the language) and
 * an object with a `locale` field (the value is). The third, a locale segment in
 * a segmented key, arrives with segmented keys.
 */
function localeScopeOf(
  node: LocaleFilterNode,
  projectLocales: string[],
): string | null {
  if (node.keySchema?.type === "locale" && node.key !== undefined) {
    return localeOfValue(node.key, projectLocales, node.keySchema.aliases);
  }
  if (node.schema?.type !== "object") {
    return null;
  }
  const source = node.source;
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return null;
  }
  for (const [field, item] of Object.entries(node.schema.items)) {
    if (item.type !== "locale") {
      continue;
    }
    const value = (source as Record<string, unknown>)[field];
    if (typeof value !== "string") {
      // Not filled in. Not one language rather than another, so it stays
      // listed — hiding it would hide the field someone has to fill in.
      return null;
    }
    return localeOfValue(value, projectLocales, item.aliases);
  }
  return null;
}
