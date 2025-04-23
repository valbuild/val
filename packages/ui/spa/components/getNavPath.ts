import {
  SourcePath,
  ModuleFilePath,
  Json,
  SerializedSchema,
  Internal,
} from "@valbuild/core";
import { resolvePatchPath } from "../resolvePatchPath";

/**
 * This defines the logic for when we should stop while moving up the path.
 * It must be in sync with the logic in the rest of UX - we should consider if there's a way to avoid an implicit contract
 */
function isSchemaNavStop(
  schema: SerializedSchema,
  parentSchema: SerializedSchema | null,
): boolean {
  if (parentSchema?.type === "array") {
    if (schema.type === "string") {
      return false;
    }
    return true;
  } else if (parentSchema?.type === "record") {
    return true;
  }
  return false;
}

export function getNavPathFromAll(
  requestedPath: SourcePath | ModuleFilePath,
  allSources: Record<ModuleFilePath, Json>,
  schemas: Record<ModuleFilePath, SerializedSchema> | undefined,
): SourcePath | ModuleFilePath | null {
  if (!schemas) {
    return null;
  }

  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(requestedPath);
  if (!modulePath) {
    return moduleFilePath;
  }

  const source = allSources[moduleFilePath];
  const schema = schemas[moduleFilePath];
  if (source === undefined || !schema) {
    return null;
  }

  const resolutionRes = resolvePatchPath(
    Internal.splitModulePath(modulePath),
    schema,
    source,
  );
  if (resolutionRes.success) {
    // Move upwards in path until we find where to stop:
    for (let i = resolutionRes.allResolved.length - 1; i >= 0; i--) {
      const resolved = resolutionRes.allResolved[i];
      const parent = resolutionRes.allResolved[i - 1];
      if (isSchemaNavStop(resolved.schema, parent?.schema || null)) {
        if (resolved.modulePath === "") {
          return moduleFilePath;
        }
        return Internal.joinModuleFilePathAndModulePath(
          moduleFilePath,
          resolved.modulePath,
        );
      }
    }
    return moduleFilePath;
  } else {
    console.error(
      `Error resolving path: ${resolutionRes.error} for path: ${requestedPath}`,
    );
  }

  return null;
}
