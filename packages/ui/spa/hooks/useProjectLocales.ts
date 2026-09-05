import { Json, SourcePath } from "@valbuild/core";
import { useMemo } from "react";
import { useSchemas, useSourceAtPath } from "../components/ValFieldProvider";
import { settingsModuleFilePath } from "./assistantSettings";
import { sourcePathOfItem } from "../utils/sourcePathOfItem";

/**
 * The languages this project publishes, from its settings module.
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
export function useProjectLocales(): string[] {
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
  return useMemo(() => {
    if (!("data" in source) || !Array.isArray(source.data)) {
      return [];
    }
    return (source.data as Json[]).filter(
      (tag): tag is string => typeof tag === "string",
    );
  }, [source]);
}
