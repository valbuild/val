import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
  type ValidationError,
} from "@valbuild/core";
import { getRoutesWithModulePaths } from "../components/getRoutesOf";

type SerializedRegExpPattern = { source: string; flags: string };

/**
 * Filters a validation errors map down to only blocking errors.
 *
 * - Errors without fixes are always blocking.
 * - Errors with fixes that are not keyof:check-keys / router:check-route are
 *   non-blocking (handled elsewhere, e.g. image metadata).
 * - keyof:check-keys and router:check-route are resolved client-side: if the
 *   referenced key/route is valid the error is dropped, otherwise kept with a
 *   message listing the valid options.
 */
export function filterBlockingValidationErrors(
  validationErrors: Record<SourcePath, ValidationError[]>,
  schemas: Record<ModuleFilePath, SerializedSchema> | null,
  sources: Record<ModuleFilePath, Json> | null,
): Record<SourcePath, ValidationError[]> {
  const blocking: Record<SourcePath, ValidationError[]> = {};

  for (const sourcePathS in validationErrors) {
    const sourcePath = sourcePathS as SourcePath;
    const errors = validationErrors[sourcePath];
    const blockingForPath: ValidationError[] = [];

    for (const error of errors) {
      const fixes = error.fixes ?? [];

      if (fixes.length) {
        const canSkip = fixes.every((fix) => {
          if (fix === "keyof:check-keys") {
            return false;
          } else if (fix === "router:check-route") {
            return false;
          } else if (
            fix === "image:add-metadata" ||
            fix === "image:check-metadata" ||
            fix === "image:upload-remote" ||
            fix === "image:download-remote" ||
            fix === "image:check-remote" ||
            fix === "images:check-remote" ||
            fix === "file:add-metadata" ||
            fix === "file:check-metadata" ||
            fix === "file:upload-remote" ||
            fix === "file:download-remote" ||
            fix === "file:check-remote" ||
            fix === "files:check-remote" ||
            fix === "images:check-unique-folder" ||
            fix === "files:check-unique-folder" ||
            fix === "images:check-all-files" ||
            fix === "files:check-all-files"
          ) {
            return true;
          } else {
            const exhaustiveCheck: never = fix;
            console.error(
              `Unknown validation fix '${exhaustiveCheck}' encountered while filtering validation errors. This fix will be treated as blocking.`,
            );
            return true;
          }
        });
        if (canSkip) {
          continue;
        }
      }

      if (fixes.includes("keyof:check-keys")) {
        const val = error.value as
          | { key: string; sourcePath: SourcePath }
          | undefined;
        if (val) {
          const validKeys = getKeysAtSourcePath(val.sourcePath, sources);
          if (validKeys.includes(val.key)) {
            continue;
          }
          blockingForPath.push({
            ...error,
            message: `Invalid key '${val.key}'. Valid keys are: ${validKeys.join(", ")}`,
          });
        } else {
          blockingForPath.push(error);
        }
        continue;
      }

      if (fixes.includes("router:check-route")) {
        const val = error.value as
          | {
              route: string;
              include?: SerializedRegExpPattern;
              exclude?: SerializedRegExpPattern;
            }
          | undefined;
        if (val) {
          const allRoutes = getRoutesWithModulePaths(
            (schemas ?? {}) as Record<ModuleFilePath, SerializedSchema>,
            (sources ?? {}) as Record<ModuleFilePath, Json>,
          );
          const includePattern = val.include
            ? new RegExp(val.include.source, val.include.flags)
            : undefined;
          const excludePattern = val.exclude
            ? new RegExp(val.exclude.source, val.exclude.flags)
            : undefined;
          const validRoutes = allRoutes
            .map((r) => r.route)
            .filter(
              (r) =>
                (!includePattern || includePattern.test(r)) &&
                (!excludePattern || !excludePattern.test(r)),
            );
          if (validRoutes.includes(val.route)) {
            continue;
          }
          blockingForPath.push({
            ...error,
            message: `Invalid route '${val.route}'. Valid routes are: ${validRoutes.join(", ")}`,
          });
        } else {
          blockingForPath.push(error);
        }
        continue;
      }

      blockingForPath.push(error);
    }

    if (blockingForPath.length > 0) {
      blocking[sourcePath] = blockingForPath;
    }
  }

  return blocking;
}

function getKeysAtSourcePath(
  sourcePath: SourcePath,
  sources: Record<ModuleFilePath, Json> | null,
): string[] {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const moduleSource = sources?.[moduleFilePath];
  let record: unknown = moduleSource;
  if (modulePath) {
    for (const part of Internal.splitModulePath(modulePath)) {
      if (record && typeof record === "object" && !Array.isArray(record)) {
        record = (record as Record<string, unknown>)[part];
      } else {
        return [];
      }
    }
  }
  if (record && typeof record === "object" && !Array.isArray(record)) {
    return Object.keys(record);
  }
  return [];
}
