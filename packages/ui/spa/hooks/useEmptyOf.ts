import { Json, SerializedSchema } from "@valbuild/core";
import { emptyOf } from "@valbuild/shared/internal";
import { useCallback } from "react";
import { useProjectLocales } from "./useProjectLocales";

/**
 * `emptyOf`, with the things it cannot read off a serialized schema.
 *
 * So far that is the project's languages, which a locale-keyed record needs:
 * such a record holds one entry per language, and the languages are declared in
 * the settings module. A bare `emptyOf` would create it empty, which is content
 * that fails validation the moment it is written.
 *
 * Every Studio path that creates a value should use this rather than importing
 * `emptyOf` directly — a new entry, a new page, a new block, a union branch —
 * because any of their schemas can contain a locale-keyed record somewhere
 * below.
 */
export function useEmptyOf(): (schema: SerializedSchema) => Json {
  const locales = useProjectLocales();
  return useCallback(
    (schema: SerializedSchema) => emptyOf(schema, { locales }),
    [locales],
  );
}
