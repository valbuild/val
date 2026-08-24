import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import { useValSystem } from "./SystemContext";

export type SchemaAtPath =
  | { status: "success"; data: SerializedSchema }
  | { status: "error"; error: string }
  | { status: "not-found" }
  | { status: "loading" };

const noopSubscribe = () => () => {};
const LOADING: SchemaAtPath = { status: "loading" };

/**
 * The serialized schema for one path's module, and its version.
 *
 * Per MODULE, not per path, and that is not a shortcut: a schema is a module-level
 * fact and `schemaStore` is keyed by module. Resolving the schema AT a path — which
 * is what a field actually wants, and which has to handle `image`/`file` absorbing
 * sub-paths like `metadata.hotspot` — is a separate walk that belongs in core, and
 * `openquestions.md` has it as "schema-at-path". Until that exists this hook
 * returns the module's schema and the caller walks, which is what the engine's
 * `useSchemaAtPathInternal` does today.
 *
 * The subscription is `schema:init` because that is the only thing that changes a
 * schema: intake, or HMR swapping one under existing source. A patch never does.
 */
export function useModuleSchema(
  sourcePath: SourcePath | ModuleFilePath,
): SchemaAtPath {
  const val = useValSystem();
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
    sourcePath as SourcePath,
  );

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) {
        return () => {};
      }
      return val.system.schemaStore.events.on("schema:init", onChange);
    },
    [val],
  );

  /**
   * The VERSION, not the schema.
   *
   * `getSnapshot` must return a stable reference, and `schemaStore.get` hands
   * back the stored object — which is stable, but only by luck of the store not
   * replacing it. The version is a number, so it is stable by construction, and
   * it is what the store already bumps when a schema is replaced.
   */
  const getVersion = useCallback(() => {
    if (val === null) {
      return null;
    }
    return val.system.schemaStore.version(moduleFilePath);
  }, [val, moduleFilePath]);

  const version = useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getVersion,
    getVersion,
  );

  return useMemo<SchemaAtPath>(() => {
    if (val === null) {
      return { status: "not-found" };
    }
    const schema = val.system.schemaStore.get(moduleFilePath);
    if (schema === undefined) {
      // `loading` rather than `not-found`: a module whose schema has not arrived
      // is the normal state before intake finishes, and rendering "no such
      // module" during startup is a worse lie than rendering a spinner.
      return LOADING;
    }
    return { status: "success", data: schema };
    // `version` is the dependency that matters — it is what changes when the
    // schema is replaced. Reading the schema inside the memo rather than through
    // `useSyncExternalStore` is what keeps the snapshot a stable number.
  }, [val, moduleFilePath, version]);
}
