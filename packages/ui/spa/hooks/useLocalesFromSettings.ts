import { Json, SourcePath } from "@valbuild/core";
import { useMemo } from "react";
import { useSchemas, useSourceAtPath } from "../components/ValFieldProvider";
import { settingsModuleFilePath } from "./assistantSettings";
import { sourcePathOfItem } from "../utils/sourcePathOfItem";

/**
 * The languages this project publishes, read from its settings module.
 *
 * Called ONCE, by the shell, and handed down through
 * {@link ProjectLocalesProvider}. Everything else asks
 * {@link useProjectLocales}, which is a context read. That split is the whole
 * point of this file existing separately: the read below is a whole-project
 * subscription — `useSchemas` wakes on every schema change, `useSourceAtPath`
 * on the settings module — and a field is mounted once per field, so a copy of
 * it in every field and every filtered row makes one edit O(project). See
 * `perFieldSubscriptions.test.ts`.
 *
 * Empty where the project has no settings module, no `locales` section, or
 * nothing in it — all of which mean the same thing, and mean it in the same way
 * for every consumer: this project has not said it is translated, so nothing
 * about locales is shown.
 *
 * Read from the SOURCE, defensively, because a settings module is a file people
 * edit: `available` can hold anything at the moment it is being typed, and a
 * field that refused to render until it was well-formed would disappear exactly
 * when someone was fixing it.
 */
export function useLocalesFromSettings(): string[] {
  const schemas = useSchemas();
  const moduleFilePath =
    schemas.status === "success" ? settingsModuleFilePath(schemas.data) : null;
  // A path that cannot exist, rather than `undefined`: the hook below is a
  // hook, so it has to be called on every render whether or not this project
  // has a settings module. It resolves to nothing, which is the answer.
  const availablePath: SourcePath = moduleFilePath
    ? sourcePathOfItem(sourcePathOfItem(moduleFilePath, "locales"), "available")
    : ("" as SourcePath);
  const source = useSourceAtPath(availablePath);
  const tags = useMemo(() => {
    if (!("data" in source) || !Array.isArray(source.data)) {
      return EMPTY;
    }
    return (source.data as Json[]).filter(
      (tag): tag is string => typeof tag === "string",
    );
  }, [source]);
  /**
   * The same array back until the languages themselves change.
   *
   * `useSourceAtPath` hands back a new object whenever anything it watches
   * moves, so the memo above recomputes — and a fresh array here would be a new
   * `locales` prop on the shell, a new context value for the whole tree, and a
   * new predicate for every filtered row, on every keystroke anywhere in the
   * project. Reference stability is load-bearing in this codebase; see
   * `architecture/stores.md`.
   *
   * Keyed on the content rather than the array, so the identity survives a
   * recompute that produced the same languages.
   */
  const key = tags.join("\u0000");
  // `tags` is deliberately not a dependency: when `key` is unchanged the
  // languages are identical, and depending on the array would defeat the point.
  return useMemo(() => tags, [key]);
}

/** One empty array, so "this project has no languages" is also stable. */
const EMPTY: string[] = [];
