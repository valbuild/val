import { Json, SerializedSchema } from "@valbuild/core";
import { emptyOf } from "@valbuild/shared/internal";
import { useCallback } from "react";
import { useProjectLocales } from "./useProjectLocales";
import { useLocaleFilter } from "../components/LocaleFilterProvider";

/**
 * `emptyOf`, with the things it cannot read off a serialized schema.
 *
 * Two of them, and neither is in the schema. The project's languages, which a
 * locale-keyed record needs: such a record holds one entry per language, and
 * the languages are declared in the settings module, so a bare `emptyOf` would
 * create it empty — content that fails validation the moment it is written.
 * And the language being worked in, which is the locale filter: a new
 * `s.locale()` field is created already set to it, so adding an item while
 * filtered to Norwegian gives you a Norwegian item rather than an invalid one
 * that immediately disappears from the list you are looking at.
 *
 * Both are context reads, not subscriptions — see `useProjectLocales` and
 * `useLocaleFilter`. That matters: this hook is called from every create path
 * and therefore from most of the field tree.
 *
 * Every Studio path that creates a value should use this rather than importing
 * `emptyOf` directly — a new entry, a new page, a new block, a union branch —
 * because any of their schemas can contain a locale field or a locale-keyed
 * record somewhere below.
 */
export function useEmptyOf(): (schema: SerializedSchema) => Json {
  const locales = useProjectLocales();
  const filter = useLocaleFilter();
  return useCallback(
    (schema: SerializedSchema) =>
      emptyOf(schema, {
        locales,
        ...(filter !== null ? { selectedLocale: filter } : {}),
      }),
    [locales, filter],
  );
}
