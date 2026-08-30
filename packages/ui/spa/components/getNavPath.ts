import {
  SourcePath,
  ModuleFilePath,
  SerializedSchema,
  Internal,
  Source,
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

/**
 * Why a path could not be turned into somewhere to navigate to.
 *
 * A reason rather than `null`, because the three of them call for three
 * different things to be said to the person who asked. "Still loading" is a
 * wait; "this module is not here" is a stale link or a deleted module; "this
 * path does not resolve" is content that has moved under a page that is still
 * tagged with where it used to be. Told apart, each is actionable; collapsed
 * into nothing, all three are a click that did nothing.
 *
 * Introduced for the canvas, where the click is on the running page and the
 * failure is otherwise completely opaque: the element is right there, and
 * pointing at it appeared to do nothing at all.
 */
export type NavPathResolution =
  | { status: "resolved"; path: SourcePath | ModuleFilePath }
  /** The schemas have not been loaded yet. Trying again shortly will work. */
  | { status: "schemas-not-loaded" }
  /** No such module, or its source has not been loaded. */
  | { status: "module-not-loaded"; moduleFilePath: ModuleFilePath }
  /** The module is here, and the path does not point at anything in it. */
  | {
      status: "unresolvable";
      moduleFilePath: ModuleFilePath;
      /** What the resolver said, for the details line of a message. */
      reason: string;
    };

/**
 * Where to navigate for a path, or why not.
 *
 * The whole of {@link getNavPathFromAll}, which is now the answer with the
 * reason thrown away — kept because most callers have nothing useful to do with
 * one, and because a `null` they already handle is better than a reason they
 * would have to invent a message for.
 */
export function resolveNavPath(
  requestedPath: SourcePath | ModuleFilePath,
  allSources: Record<ModuleFilePath, Source>,
  schemas: Record<ModuleFilePath, SerializedSchema> | undefined,
): NavPathResolution {
  if (!schemas) {
    return { status: "schemas-not-loaded" };
  }

  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(requestedPath);
  if (!modulePath) {
    return { status: "resolved", path: moduleFilePath };
  }

  const source = allSources[moduleFilePath];
  const schema = schemas[moduleFilePath];
  if (source === undefined || !schema) {
    return { status: "module-not-loaded", moduleFilePath };
  }

  const resolutionRes = resolvePatchPath(
    Internal.splitModulePath(modulePath),
    schema,
    source,
  );
  if (!resolutionRes.success) {
    return {
      status: "unresolvable",
      moduleFilePath,
      reason: String(resolutionRes.error),
    };
  }
  // Move upwards in path until we find where to stop:
  for (let i = resolutionRes.allResolved.length - 1; i >= 0; i--) {
    const resolved = resolutionRes.allResolved[i];
    const parent = resolutionRes.allResolved[i - 1];
    if (isSchemaNavStop(resolved.schema, parent?.schema || null)) {
      if (resolved.modulePath === "") {
        return { status: "resolved", path: moduleFilePath };
      }
      return {
        status: "resolved",
        path: Internal.joinModuleFilePathAndModulePath(
          moduleFilePath,
          resolved.modulePath,
        ),
      };
    }
  }
  return { status: "resolved", path: moduleFilePath };
}

export function getNavPathFromAll(
  requestedPath: SourcePath | ModuleFilePath,
  allSources: Record<ModuleFilePath, Source>,
  schemas: Record<ModuleFilePath, SerializedSchema> | undefined,
): SourcePath | ModuleFilePath | null {
  const resolution = resolveNavPath(requestedPath, allSources, schemas);
  if (resolution.status === "resolved") {
    return resolution.path;
  }
  if (resolution.status === "unresolvable") {
    console.error(
      `Error resolving path: ${resolution.reason} for path: ${requestedPath}`,
    );
  }
  return null;
}
