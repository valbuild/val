import { localeOfValue, type SerializedSchema } from "@valbuild/core";
import { createContext, ReactNode, useContext, useMemo } from "react";
import { useProjectLocales } from "../hooks/useProjectLocales";

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
