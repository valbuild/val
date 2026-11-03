import type { Json, ModuleFilePath, PatchId } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import {
  baseModuleContent,
  moduleKey,
  type EntryState,
  type EntryVersion,
  type ModuleContent,
  type ModuleVersion,
} from "@valbuild/shared/internal";

/*
 * The Studio's origin tier: its own server, one endpoint
 * (`GET /modules/~<path>?v=<moduleKey>[&have=<moduleKey>]`, phase 6's). See
 * `docs/plans/one-content-model.md`, "The store: one address, immutable
 * values, tiers" and "The Studio loads everything from one place".
 *
 * Asked last: the Studio's memory (the versions it computed, `VersionRing`)
 * and its bundle answer first, and only a version neither holds -- another
 * editor's edit, a base this bundle was not built with, a publish -- costs a
 * request. With the version the Studio holds of the same schema and base
 * (`have`), the answer is the patches from it, so another editor's keystroke
 * costs one patch on the wire, not the module.
 */

/** What `GET /modules` answered, as the store reads it. */
export type ModuleFetchAnswer =
  | {
      kind: "module";
      version: ModuleVersion;
      /** `.jsonValues()` markers without their `import()`. */
      source: Json;
      /** The entries its chain touched, read. */
      entries: Record<
        string,
        | { content: Json; version?: EntryVersion }
        | { deleted: true; version?: EntryVersion }
        | { error: string; patchId?: PatchId; version?: EntryVersion }
      >;
      /** The patch ids its chain is made of; absent from an older server. */
      patches?: PatchId[];
      failed?: { patchId: PatchId; message: string };
    }
  | {
      kind: "delta";
      from: ModuleVersion;
      to: ModuleVersion;
      patches: { patchId: PatchId; patch: Patch }[];
    }
  /** That version is not held there; `current` is the one that is. */
  | { kind: "not-held"; current?: ModuleVersion }
  | { kind: "error"; message: string };

/**
 * `GET /modules/~<path>`: `v` the version wanted (the newest when absent),
 * `have` the version held. The network, as a seam: `createValSystem` is the
 * one place that knows it is HTTP.
 */
export type FetchModule = (
  path: ModuleFilePath,
  query: { v?: string; have?: string },
) => Promise<ModuleFetchAnswer>;

/** A module the origin answered whole: the store's shape of it. */
export type OriginModule = {
  version: ModuleVersion;
  content: ModuleContent;
  patches: readonly PatchId[];
};

/**
 * One module at `version`, from the origin. `have` is the version held of
 * the same module, when there is one of the same schema and base: a delta
 * comes back relative to it, and `extend` turns that into the module (`null`
 * when a patch of it does not apply here, and then the whole module is asked
 * for). `null` when the origin could not answer.
 */
export async function originTier(
  fetchModule: FetchModule,
  path: ModuleFilePath,
  version: ModuleVersion,
  have: {
    version: ModuleVersion;
    extend: (
      patches: { patchId: PatchId; patch: Patch }[],
    ) => OriginModule | null;
  } | null,
): Promise<
  | { status: "found"; module: OriginModule }
  | { status: "moved"; current: ModuleVersion | undefined }
  | { status: "error"; message: string }
> {
  const v = moduleKey(path, version);
  const ask = async (withHave: boolean) =>
    fetchModule(path, {
      v,
      ...(withHave && have !== null
        ? { have: moduleKey(path, have.version) }
        : {}),
    });
  let answer = await ask(true);
  if (answer.kind === "delta") {
    const extended = have?.extend(answer.patches) ?? null;
    if (extended !== null) return { status: "found", module: extended };
    answer = await ask(false);
  }
  if (answer.kind === "module") {
    return { status: "found", module: moduleOfAnswer(answer) };
  }
  if (answer.kind === "not-held") {
    return { status: "moved", current: answer.current };
  }
  if (answer.kind === "error") {
    return { status: "error", message: answer.message };
  }
  return {
    status: "error",
    message: `The server answered a delta for ${path} that does not apply to the version held`,
  };
}

/** A whole module as the origin sent it, as the engine holds content. */
export function moduleOfAnswer(
  answer: Extract<ModuleFetchAnswer, { kind: "module" }>,
): OriginModule {
  const base = baseModuleContent(answer.source);
  const entries = new Map<string, EntryState>();
  for (const [key, entry] of Object.entries(answer.entries)) {
    if ("content" in entry) {
      entries.set(key, { kind: "content", content: entry.content });
    } else if ("deleted" in entry) {
      entries.set(key, { kind: "deleted" });
    } else {
      const patchId = entry.patchId ?? answer.failed?.patchId;
      // Without the patch that made it, there is nothing to discard: the
      // entry stays the base's marker, and is read as the base's.
      if (patchId === undefined) continue;
      entries.set(key, { kind: "error", patchId, message: entry.error });
    }
  }
  return {
    version: answer.version,
    content:
      entries.size === 0 ? base : { source: base.source, entries: entries },
    patches: answer.patches ?? [],
  };
}
