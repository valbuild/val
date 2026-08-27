import type {
  Json,
  ModuleFilePath,
  PatchId,
  SerializedSchema,
  SourcePath,
  ValidationErrors,
} from "@valbuild/core";
import type { ParentRef, Patch } from "@valbuild/core/patch";
import type { SyncState } from "./PatchSync";

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
  /**
   * The commit this patch was applied in, if it has been published.
   *
   * From the server's `appliedAt`. A published patch stays in the chain in
   * `http` mode — the server re-applies it — so "is it in the chain" and "has it
   * shipped" are different questions, and the review UI shows the difference.
   * `undefined` for a patch created locally, which by definition has not.
   */
  appliedAt?: { commitSha: string } | null;
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
 * How much the source of ONE module has moved.
 *
 * The comparator for reads, and deliberately not the patch head. The patch head
 * describes the chain, and the chain cannot see a base-source replacement — a new
 * commit, `PUT /sources/~`, HMR, or a `.jsonValues()` entry file changing on disk
 * all change what a read returns without touching it. A reader asks "did my value
 * change?"; the chain answers "did the chain change?". Those coincide for patches
 * and diverge for everything else, which is why this counter lives in the source
 * store, next to the assignments that mutate source.
 *
 * PER MODULE, not global. A patch in module A must not make a module-B reader
 * re-read, and that matters most for `.jsonValues()`: one local `*.val.json` save
 * marks every entry stale, which under a global counter would make every mounted
 * field in the project re-read for content it does not show.
 */
export type Revision = {
  module: ModuleFilePath;
  /** Monotonic within `module`. Comparison is one `<`. */
  n: number;
};

/**
 * Is `candidate` strictly newer than `held`?
 *
 * The whole of out-of-order reply handling. A reader keeps the newest revision it
 * has accepted and drops any reply that is not newer — safe precisely because a
 * drop can only happen once something better has arrived, so there is always a
 * value and it is always the newest. No retry, no timer, and no way to cycle:
 * dropping schedules nothing.
 *
 * Throws across modules rather than answering. Two revisions for different
 * modules are not ordered, and silently returning `false` would let a reader
 * treat a foreign revision as "not newer" and keep stale data.
 */
export function isNewerRevision(candidate: Revision, held: Revision): boolean {
  if (candidate.module !== held.module) {
    throw new Error(
      `Revisions are per module and not comparable across them: ${candidate.module} vs ${held.module}`,
    );
  }
  return candidate.n > held.n;
}

/**
 * The answer to `SourceStore.get(path, head)`.
 *
 * Every answer that says anything about the value carries **the head it was
 * computed at**. That is what lets a reader handle out-of-order replies by
 * keeping the newest and dropping the rest — see {@link isNewerHead}.
 *
 * There is deliberately no "re-ask" status. An earlier version refused to answer
 * a read whose quoted head had moved, which meant a caller had to retry, which
 * needed a retry cap and was the one way the design could hang. Answering always
 * makes progress in a single round trip.
 */
export type SourceRead =
  | { status: "resolved-head"; data: Json; revision: Revision }
  /**
   * The head you quoted is still current, so what you already hold is right and
   * no value was marshalled.
   *
   * The reason to pass a head at all: once source is across a worker seam, the
   * cheap answer is the difference between a read costing a structured clone and
   * costing nothing.
   */
  | { status: "unchanged"; revision: Revision }
  /**
   * DEFINITIVE: the module is loaded, every known patch is applied, and the
   * path is not there. Distinct from `module-loading`, which says nothing at
   * all about the path.
   */
  | { status: "absent"; revision: Revision }
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
  /** What this path's module has moved to, so a woken reader knows what it
   *  would be reading at without asking. */
  revision: Revision;
};

/**
 * Every event any store in the system emits, as one union.
 *
 * Names are `<store>:<event>`, so the ledger can be read and filtered by which
 * store spoke.
 */
/**
 * A patch that could not be applied, and who found it.
 *
 * `source` matters because the two sides cannot see the same things: the client
 * applies patches to the evaluated JSON with JSONOps, while `/save` applies them
 * to the `.val.ts` AST. A patch can apply here and still be rejected there — a
 * `c.image` metadata key that is not literally present, a non-literal
 * initializer, an array shorter in the source than in the evaluated JSON — so a
 * client that treated a server refusal as its own would conclude it had resolved
 * itself the next time it applied cleanly.
 */
export type PatchErrorEntry = {
  message: string;
  source: "client" | "server";
};

export type SystemEvent =
  /** The host app handed over modules (intake, or an HMR re-run). */
  | { type: "host:receive"; modules: ModuleFilePath[] }
  | { type: "schema:init"; modules: ModuleFilePath[] }
  | { type: "source:init"; sources: ModuleFilePath[] }
  /**
   * This module's source revision moved. Whatever the reason.
   *
   * Emitted from `SourceStore.bump` and nowhere else, which is the whole value
   * of it: `bump` is the single place a revision changes, so a consumer that
   * only wants to know "could a read of this module answer differently now"
   * cannot miss a case. The alternative is to listen to the union of
   * `source:init`, `source:patch-apply`, `source:patch-drop`, entry receipt and
   * base promotion — five events today, and a sixth way to change source silently
   * breaks every consumer that enumerated the first five.
   *
   * The specific events are still there and are still the right thing for a
   * consumer that cares WHY. This is for the ones that only care THAT.
   */
  | { type: "source:change"; moduleFilePath: ModuleFilePath }
  /**
   * A reader registered interest in a path, or dropped it.
   *
   * This IS coordination rather than observation, which is why it is a
   * `SystemEvent` and not a work record: the render store reacts to it. A
   * listener existing at a path is the system's own record that a field is on
   * screen showing it, and therefore the only trustworthy signal that the
   * expensive work behind that path is actually wanted. A caller invoking
   * `get()` is not the same thing — that is a caller choosing to pay, which a
   * speculative or already-unmounted one can also do.
   */
  | { type: "source:listen"; path: SourcePath; moduleFilePath: ModuleFilePath }
  | {
      type: "source:unlisten";
      path: SourcePath;
      moduleFilePath: ModuleFilePath;
    }
  /** `/stat` announced the ordered patch-id list. Data not fetched yet. */
  | { type: "stat:receive"; patches: PatchId[] }
  /** Patch *data* has arrived for these ids and is now readable. */
  | { type: "patch:receive"; patches: PatchId[] }
  /**
   * `/stat` announced these ids, and the fetch came back without them.
   *
   * A server contradicting itself, and the reason it is an event rather than a
   * silence: the edits these ids carry are not on screen, so anything typed now
   * is written on top of content that is missing them.
   */
  | { type: "patch:announced-not-delivered"; patches: PatchId[] }
  /**
   * The server discarded these unpublished changes because it could not read
   * them, and is saying so.
   *
   * Different from a rejected save, which is one patch the server refused at the
   * moment it was written. This is work that was already accepted and is now
   * gone — from a repair on the other side, not from anything happening here.
   */
  | {
      type: "patch:removed-by-server";
      removed: { patchId: PatchId; reason: string }[];
    }
  /** A patch was created locally. Its data exists immediately. */
  | { type: "patch:create"; patches: PatchId[] }
  /**
   * The chain moved. Whatever the reason.
   *
   * Emitted from `PatchStore`'s `bump` and nowhere else, so a consumer that only
   * wants to know "could a read of the chain answer differently now" cannot miss
   * a case — the same reasoning as `source:change`, and it was not hypothetical
   * here: `markSaved` moved the chain version and emitted nothing at all, so a
   * reader of what is still PENDING was never told that an edit had been saved.
   *
   * The specific events (`patch:create`, `patch:saved`, `patch:drop`, ...) are
   * still the right thing for a consumer that cares WHY. This is for the ones
   * that only care THAT.
   */
  | { type: "patch:chain"; version: number }
  /**
   * These locally-created patches are on their way to the server.
   *
   * The write is the one thing in this system that is NOT demand-driven: a read
   * is only owed if someone asks, but an edit the user made has to reach the
   * server whether or not anything reads it again. So the save has its own
   * events rather than being a side effect of a read.
   */
  | { type: "patch:save"; patches: PatchId[]; parentRef: ParentRef }
  /** The server accepted them. They are no longer local-only. */
  | { type: "patch:saved"; patches: PatchId[]; parentRef: ParentRef }
  /**
   * The server said our parent is no longer the head (409).
   *
   * Someone else wrote. Nothing is lost: the patches stay pending, the chain is
   * re-synced, and they are re-sent against the new head. Announced because it
   * is the one state where the user's edit is real locally and provably not yet
   * real anywhere else.
   */
  | { type: "patch:save-conflict"; patches: PatchId[]; message: string }
  /**
   * The server refused them permanently (400), so they were dropped locally.
   *
   * Distinct from a conflict on purpose: a conflict is retried and a rejection
   * cannot be. The patches no longer exist, and the source has been rebuilt
   * without them — a `source:patch-drop` says which modules moved.
   */
  | {
      type: "patch:save-rejected";
      patches: PatchId[];
      message: string;
      errors?: Record<ModuleFilePath, string[]>;
    }
  /**
   * Something the editor should be told changed: an error, the network, the
   * schema's freshness. One event for all of them because a UI shows them
   * together — see `StatusStore`.
   */
  | { type: "status:change" }
  /** Patches were removed from the chain, and source rebuilt without them. */
  | { type: "patch:drop"; patches: PatchId[]; modules: ModuleFilePath[] }
  /**
   * The write queue moved: in-sync, pending, saving, retrying.
   *
   * Separate from the four events above because those announce OUTCOMES and this
   * announces the state in between. A UI showing "saving..." needs the state, and
   * without this event it could not see it: a system with no write seam sets
   * `pending` and emits nothing else at all, so a consumer polling only the
   * outcome events would report every unsaved edit as in-sync.
   *
   * Emitted only when the state actually changes — a drain that concludes
   * `in-sync` twice is not news.
   */
  | { type: "patch:sync-state"; state: SyncState }
  /**
   * Source was rebuilt from base + the surviving chain.
   *
   * Its own event rather than a `source:patch-apply`: an apply says "this patch
   * landed", and this says the opposite — a value moved because something was
   * taken away. A consumer that invalidates on either is correct; one that
   * counts patches as it goes would be wrong to treat them as the same news.
   */
  | { type: "source:patch-drop"; modules: ModuleFilePath[] }
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
    }
  | { type: "references:invalidate"; modules: ModuleFilePath[] }
  | { type: "references:scan"; modules: ModuleFilePath[] };

export type SystemEventType = SystemEvent["type"];

export type SchemaSnapshot = Record<ModuleFilePath, SerializedSchema>;
