import {
  Internal,
  type ModuleFilePath,
  type ModulePath,
  type PreviewItem,
  type ReifiedPreview,
  type Source,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import { useMemo, useSyncExternalStore } from "react";
import { useValSystem } from "../stores/react/SystemContext";
import { usePreviewDemand } from "./usePreviewDemand";
import { resolveRefPreview } from "./useRefPreview";
import { describePath, type Description } from "../utils/describePath";

/**
 * What a LIST of paths is called, in one pass.
 *
 * `useDescription` is the per-path hook and stays the right call for a field.
 * It cannot be the right call for a list: the review page renders one row per
 * patch set and the compare dialog one per changed path, the count changes as
 * edits land, and a hook per row is a hook in a loop.
 *
 * The shape is the one `usePreviewDemand` documents. Demand is registered per
 * MODULE — one listener each, never one per row — because a preview is computed
 * for a module with a listener on it and no other, and a router module with
 * eight hundred pages must not become eight hundred subscriptions. The names
 * then come out of the one reified answer per module, via `peek`, which is a
 * read and not a second demand signal.
 *
 * Without the demand this page looks broken rather than unfinished: the titles
 * appear only for whichever module the editor happens to have open, so a list
 * where three rows are named and six are keys reads as data missing.
 */
export type Descriptions = {
  /**
   * Never fails. A path that was not in the list still gets a name — its own
   * last segment — because a `Description` is not optional and a row with no
   * name cannot render. `origin.title` says it is a fallback either way.
   */
  describe: (path: SourcePath) => Description;
};

export function useDescriptions(paths: readonly SourcePath[]): Descriptions {
  const val = useValSystem();
  const modules = useMemo(() => modulesOf(paths), [paths]);
  usePreviewDemand(modules);

  /*
   * Re-resolve when a preview lands, when source moves, or when schemas
   * arrive. Every one of the three changes an answer here: the preview IS the
   * title, the source is what the closure runs over, and the schema is what
   * says whether the last segment is a key, an index or a route.
   */
  const version = useSyncExternalStore(
    (onChange) => {
      if (val === null) return () => {};
      const offs = [
        val.system.previewStore.events.on("preview:result", onChange),
        val.system.previewStore.events.on("preview:invalidate", onChange),
        val.system.schemaStore.events.on("schema:init", onChange),
      ];
      return () => {
        for (const off of offs) off();
      };
    },
    () => val?.system.previewStore.all() ?? null,
    () => null,
  );

  return useMemo<Descriptions>(() => {
    const out = new Map<SourcePath, Description>();
    if (val === null) {
      /*
       * A path-derived name rather than nothing, so the page renders before the
       * system is up. `describePath` always produces a title — that is its
       * contract — and `origin.title` says it is a fallback, so no surface can
       * mistake `hero_2` for a name somebody chose.
       */
      for (const path of paths) out.set(path, describePath({ path }));
      return { describe: (path) => out.get(path) ?? describePath({ path }) };
    }
    void version;
    for (const path of paths) {
      out.set(path, describeOne(val.system, path));
    }
    return {
      describe: (path) => out.get(path) ?? describeOne(val.system, path),
    };
  }, [val, paths, version]);
}

type SystemLike = NonNullable<ReturnType<typeof useValSystem>>["system"];

function modulesOf(paths: readonly SourcePath[]): ModuleFilePath[] {
  const seen: ModuleFilePath[] = [];
  for (const path of paths) {
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
    if (!seen.includes(moduleFilePath)) seen.push(moduleFilePath);
  }
  return seen;
}

/**
 * The three things `describePath` needs, fetched without a hook.
 *
 * The same three `useDescription` gathers, read straight off the stores —
 * which is allowed here precisely because demand was registered above. A
 * `peek` on a module nobody asked about answers "nothing computed", and that
 * is the correct answer for it rather than a reason to compute.
 */
function describeOne(system: SystemLike, path: SourcePath): Description {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const moduleSchema = system.schemaStore.get(moduleFilePath);
  const moduleSource = system.sourceStore.moduleSource(moduleFilePath);
  if (moduleSchema === undefined || moduleSource === undefined) {
    return describePath({ path });
  }
  const schema = resolveSchema(moduleSchema, moduleSource, modulePath);
  const parentPath = Internal.parentOfSourcePath(path);
  /*
   * The CONTAINER's schema, which is what says whether the last segment is an
   * array index, a record key or a route — three things that must not be shown
   * the same way. `undefined` at a module root, which has no container.
   */
  const parentSchema =
    parentPath === path
      ? undefined
      : resolveSchema(
          moduleSchema,
          moduleSource,
          Internal.splitModuleFilePathAndModulePath(parentPath)[1],
        );
  return describePath({
    path,
    preview: previewOf(system, path, parentSchema),
    schema,
    parentSchema,
  });
}

function resolveSchema(
  moduleSchema: SerializedSchema,
  moduleSource: Source,
  modulePath: ModulePath,
): SerializedSchema | undefined {
  try {
    const resolved = Internal.safeResolvePath(
      modulePath,
      moduleSource,
      moduleSchema,
    );
    return resolved.status === "ok" ? resolved.schema : undefined;
  } catch {
    /*
     * A path that no longer resolves is the NORMAL case here, not a bug: this
     * page lists changes, and a change can be the removal of the very entry
     * whose name we are asking for. The path's own segments are then the only
     * name there is, which is what `describePath` falls back to.
     */
    return undefined;
  }
}

/**
 * A value's preview, by whichever of the two routes it has.
 *
 * Its own `self` for a module root or an object's field; its container's
 * `rows` for an item of an array or record. They cannot both be present, so
 * the order is a preference in name only — the same order `useDescription`
 * uses, and for the same reason.
 *
 * The container lookup is `resolveRefPreview`, the same function the per-path
 * hook calls. It is the half with the trap in it — a record key that looks
 * like a number must not be re-parsed, and an array's windowed rows must be
 * found by index rather than by position — and a second copy of that here
 * would be a second place for it to be got wrong.
 */
function previewOf(
  system: SystemLike,
  path: SourcePath,
  parentSchema: SerializedSchema | undefined,
): PreviewItem | undefined {
  const own = peekEntry(system, path);
  if (own?.status === "success" && own.data.self !== undefined) {
    return own.data.self;
  }
  const parentPath = Internal.parentOfSourcePath(path);
  if (parentPath === path) return undefined;
  return resolveRefPreview(
    path,
    parentPath,
    parentSchema,
    peekEntry(system, parentPath),
  );
}

/** One path's cached preview entry, or `undefined` when nothing is computed. */
function peekEntry(
  system: SystemLike,
  path: SourcePath,
): ReifiedPreview[SourcePath] | undefined {
  const read = system.previewStore.peek(path);
  return read.status === "previewed" ? read.preview : undefined;
}
