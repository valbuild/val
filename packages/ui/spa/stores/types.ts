import type {
  Json,
  ModuleFilePath,
  PatchId,
  SerializedSchema,
  SourcePath,
  ValidationErrors,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";

/**
 * A patch as it exists once its data is known: the ops plus the module they
 * apply to plus the id that orders them.
 *
 * This is deliberately the shape `GET /patches` returns
 * ({@link file://./../../../shared/src/internal/ApiRoutes.ts} `/patches` GET),
 * minus the fields no store in this prototype reads yet, so the fake server in
 * `testSystem.ts` can be swapped for the real client without moving any event.
 */
export type PatchRecord = {
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  patch: Patch;
  /** Free-form in the prototype: the test passes `{ author: "test" }`. */
  meta?: Record<string, Json>;
  /**
   * Both optional because the patch chain does not need them — only the
   * patch-set store does, to group and order patches for review. A record
   * without them still applies; it just groups under an unknown author.
   */
  createdAt?: string;
  authorId?: string | null;
};

/**
 * Where a patch came from, which is the only thing a field needs in order to
 * decide whether an event is news to it.
 *
 * `internal` — created in this session, by `PatchStore.createPatch`.
 * `external` — announced by `/stat`, so it came from another session or tab.
 */
export type PatchOrigin = "internal" | "external";

/**
 * `complete` — the patch's data is loaded and it applied to source cleanly.
 * `partial`  — the id is known but the data has not arrived, or has not been
 *              applied yet. Says nothing about whether it *will* apply.
 * `failed`   — the data is loaded and applying it to source failed.
 */
export type HeadStatus = "complete" | "partial" | "failed";

/**
 * The last patch in the system's single linear patch chain, plus enough about
 * it to answer "is what I am holding current?".
 *
 * One global head, not one per module: the server already keeps a single linear
 * chain (`parentRef: { type: "patch"; patchId }`), so this mirrors it. The cost
 * is that a patch in module A makes a module-B reader's head stale, so it
 * re-asks once and gets its unchanged value back — a wasted read, never wrong
 * data.
 */
export type Head =
  | { type: "empty" }
  | {
      type: `${PatchOrigin}-${HeadStatus}`;
      patchId: PatchId;
      /** `null` while the id is known but the data has not been fetched. */
      patch: PatchRecord | null;
    };

/**
 * The answer to `SourceStore.get(path, head)`.
 *
 * `resolved-head` is the only status that means "this value is current as of the
 * head you quoted". Everything else tells the caller what to do next, so a
 * stale answer can never be mistaken for a fresh one.
 */
export type SourceRead =
  | { status: "resolved-head"; data: Json }
  /** The quoted head is not the one behind this value. Re-ask at `head`. */
  | { status: "resolved-out-of-date"; head: Head }
  /**
   * DEFINITIVE: the module is loaded, every known patch is applied, and the
   * path is not there. Distinct from `module-loading`, which says nothing at
   * all about the path.
   */
  | { status: "absent" }
  | { status: "module-loading" }
  | { status: "error"; message: string };

/**
 * What a field listener is handed. It is a *notification*, not a value: the
 * field reads back from the store that fired it. That keeps the event small
 * (no source in it) and keeps the store free to answer the read from whatever
 * it has by then.
 */
export type FieldEvent = {
  type: `${PatchOrigin}-patch`;
  /** The registered path, not the patch's path — so `?"a"` gets its own name
   *  back even when the patch that woke it landed on `?"a".b`. */
  path: SourcePath;
  head: Head;
};

/**
 * Every event any store in the system emits, as one union.
 *
 * Names are `<store>:<event>`, so the ledger can be read and filtered by which
 * store spoke.
 */
export type SystemEvent =
  /** The host app handed over modules (intake, or an HMR re-run). */
  | { type: "host:receive"; modules: ModuleFilePath[] }
  | { type: "schema:init"; modules: ModuleFilePath[] }
  | { type: "source:init"; sources: ModuleFilePath[] }
  /** `/stat` announced the ordered patch-id list. Data not fetched yet. */
  | { type: "stat:receive"; patches: PatchId[] }
  /** Patch *data* has arrived for these ids and is now readable. */
  | { type: "patch:receive"; patches: PatchId[] }
  /** A patch was created locally. Its data exists immediately. */
  | { type: "patch:create"; patches: PatchId[] }
  | { type: "patch:head"; head: Head }
  | {
      type: "source:patch-apply";
      success: PatchId[];
      failed: { patchId: PatchId; message: string }[];
      /**
       * Modules whose source actually changed.
       *
       * Reported here rather than recovered by the consumers: the source store
       * is the only place that knows which applies landed, and every consumer
       * that needs it (validation, search) would otherwise need its own
       * patch-id-to-module index — three copies of one fact, each able to drift.
       */
      modules: ModuleFilePath[];
    }
  /** The grouping changed. Carries the patch-set paths that moved. */
  | { type: "patch-set:update"; patchSetPaths: string[] }
  /**
   * These modules' errors are STALE, and no new ones have been computed.
   *
   * Emitted instead of validating, which is the whole point: today every
   * keystroke costs a validation round-trip. A reader that shows errors can
   * keep showing the old ones (greyed) or clear them, but it is told rather
   * than left to guess.
   */
  | { type: "validation:invalidate"; modules: ModuleFilePath[] }
  | {
      type: "validation:result";
      moduleFilePath: ModuleFilePath;
      errors: ValidationErrors;
      /**
       * Where this module's custom validators were found. The store found them
       * by walking the SERIALIZED schema; it cannot run them, because a
       * deserialized schema has no user functions in it. The host store does
       * that, and its result is merged into `errors` before this is emitted.
       */
      customValidatePaths: SourcePath[];
      /** Whether the custom half actually ran, or the host could not do it. */
      customValidateStatus: "ran" | "not-needed" | "unavailable" | "error";
    }
  /** Cached renders for these modules are stale. Nothing was recomputed. */
  | { type: "render:invalidate"; modules: ModuleFilePath[] }
  | { type: "render:result"; moduleFilePath: ModuleFilePath }
  /**
   * A render threw. Deliberately not fatal: a render is decoration, and a
   * schema whose render throws must not take the module's fields down with it.
   */
  | { type: "render:error"; moduleFilePath: ModuleFilePath; message: string }
  | { type: "search:invalidate"; modules: ModuleFilePath[] }
  | {
      type: "search:build-index";
      /** Modules indexed for the first time. */
      new: ModuleFilePath[];
      /** Every module now in the index. */
      all: ModuleFilePath[];
    };

export type SystemEventType = SystemEvent["type"];

export type SchemaSnapshot = Record<ModuleFilePath, SerializedSchema>;
