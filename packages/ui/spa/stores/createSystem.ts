import type {
  ModuleFilePath,
  PatchId,
  SelectorSource,
  SerializedSchema,
  Source,
  SourcePath,
  ValModule,
  ValidationErrors,
} from "@valbuild/core";
import { SchemaValidator } from "../validation/validateModule";
import { filterBlockingValidationErrors } from "../validation/blockingValidationErrors";
import { describeStuckSave } from "../utils/describeStuckSave";
import { SchemaStore } from "./SchemaStore";
import { SourceStore, type FetchJsonEntry } from "./SourceStore";
import {
  PatchStore,
  type CreatePatchId,
  type FetchPatches,
  type UploadFile,
} from "./PatchStore";
import { StatStore } from "./StatStore";
import { StatusStore } from "./StatusStore";
import { PatchSync, type ResyncChain, type SavePatches } from "./PatchSync";
import { HostStore } from "./HostStore";
import { RenderStore } from "./RenderStore";
import { PatchSetStore, type PatchSetRequest } from "./PatchSetStore";
import { PatchSetChain, type PatchSetPlan } from "./PatchSetChain";
import type { PatchErrorEntry, PatchRecord } from "./types";
import { ValidationStore } from "./ValidationStore";
import {
  SearchStore,
  type SearchResult,
  type SourceSnapshot,
} from "./SearchStore";
import {
  ReferenceStore,
  type Reference,
  type ReferenceQuery,
  type ReferenceScan,
  type ReferenceSnapshot,
} from "./ReferenceStore";
import type { SerializedPatchSet } from "../utils/PatchSets";
import type { HostBridge, SchemaValidationBridge } from "./bridges";
import { noopActivity, type ActivitySink } from "./activity";
import { StaleModules } from "./StaleModules";
import type {
  DiscardPatches,
  PublishPatches,
  PublishResult,
} from "./PublishSeam";
import type {
  PatchSetBridge,
  ReferenceBridge,
  SearchBridge,
} from "./workerBridge";

/**
 * How long a chain movement waits before the pending modules are validated.
 *
 * Short enough that the publish gate is right by the time anyone reaches for
 * the button, long enough that a burst of keystrokes is one validation rather
 * than one per patch. See `scheduleValidationOfPendingModules`.
 */
const PENDING_VALIDATION_DEBOUNCE_MS = 300;

/**
 * How long a publish waits for local edits to reach the server.
 *
 * One save round trip, with room to spare. Past it the publish refuses rather
 * than waiting on: see `publish`, which has to answer the Save button.
 */
const SAVE_FLUSH_TIMEOUT_MS = 5000;

/**
 * Stores in the HOST realm: they either hold user closures, or need to read
 * something that does.
 */
export type HostRealm = {
  host: HostStore;
  stat: StatStore;
  schemaStore: SchemaStore;
  sourceStore: SourceStore;
  patchStore: PatchStore;
  /**
   * Everything the editor is TOLD — errors, the network, whether the schema it
   * holds is still the server's. Host realm: it is announcements, not content.
   */
  status: StatusStore;
  /**
   * The write-back loop. In the host realm because it drives the patch store,
   * and because a retry timer has to live where the chain does.
   */
  patchSync: PatchSync;
  renderStore: RenderStore;
  validationStore: ValidationStore;
};

/**
 * The WORKER realm: lazy, snapshot-shaped consumers holding no reference to
 * anything in the host realm.
 *
 * Typed as BRIDGES rather than as the concrete stores, and that is the payoff of
 * making the seam crossable: the in-process store satisfies the bridge
 * structurally, so the default costs nothing, and a real worker (see
 * `workerBridge.ts` / `workerEntry.ts`) drops in through `SystemOptions` without
 * a single caller changing. The same shape `SchemaValidationBridge` already has.
 */
export type WorkerRealm = {
  searchStore: SearchBridge;
  patchSetStore: PatchSetBridge;
  referenceStore: ReferenceBridge;
};

export type System = HostRealm &
  WorkerRealm & {
    /**
     * Gather the snapshot the search index needs and hand it across the worker
     * seam. Explicit, because this is the one operation in the system that
     * copies every module — it must be a thing someone chose to do, not a side
     * effect of an edit.
     */
    buildSearchIndex(): Promise<{
      new: ModuleFilePath[];
      all: ModuleFilePath[];
    }>;
    /**
     * The patch-set grouping, gathered and built on demand.
     *
     * On the system rather than on the store for the same reason
     * `buildSearchIndex` is: the store is in the worker realm and cannot reach
     * the chain it needs, so the host side gathers and passes.
     */
    getPatchSets(): Promise<SerializedPatchSet>;
    /**
     * Search, indexing first if the index is missing or stale.
     *
     * The query is the demand signal, so it is the query that pays. Going
     * through the system is what makes that possible: the search store cannot
     * gather the snapshot itself.
     */
    search(
      query: string,
      limit?: number,
      offset?: number,
    ): Promise<SearchResult>;
    /**
     * Who points at this thing, scanning first if the index owes a pass.
     *
     * On the system for the same reason `search` is: the reference store is in
     * the worker realm and cannot gather the source it needs. The QUERY is the
     * demand signal, so the query is what pays.
     */
    findReferences(query: ReferenceQuery): Promise<ReferenceScan>;
    /** What the field at one path points at. Scans first if a pass is owed. */
    referenceAt(path: SourcePath): Promise<Reference | null>;
    /**
     * Commit patches, if they are publishable.
     *
     * On the system because it is the one operation that needs three stores at
     * once: validation decides whether it may happen, patches say what is being
     * published, and source has to be left showing the right thing afterwards.
     */
    publish(patchIds: PatchId[], message?: string): Promise<PublishResult>;
    /**
     * Throw patches away.
     *
     * The opposite of publish in the one way that matters here: a discarded
     * patch's effect must DISAPPEAR, so source is rebuilt without it, whereas a
     * published patch's effect stays because it is in the base now.
     */
    discard(
      patchIds: PatchId[],
    ): Promise<{ status: "discarded" } | { status: "failed"; message: string }>;
    /**
     * Per patch in the chain: what `/save` refused it for, or `null`.
     *
     * On the system rather than read off the patch store by the caller only so
     * that "everything a publish gate needs" is reachable from one place.
     */
    patchErrors(): Record<ModuleFilePath, Record<PatchId, PatchErrorEntry>>;
    /**
     * Tell the system whether a publish leaves the patches on the server.
     *
     * A setter, and not only a constructor option, because the answer comes from
     * `/stat` — which lands after the Studio has mounted and taken the project
     * in. Rebuilding the system when it arrives (what `ValProvider` used to do,
     * by memoising on `mode`) silently discards the first one: its listeners are
     * attached at construction and never detached, its `PatchSync` retry loop
     * keeps running, and any patch created in that window goes with it.
     */
    setMode(mode: "fs" | "http"): void;
    dispose(): void;
  };

export type SystemOptions = {
  fetchPatches: FetchPatches;
  createPatchId?: CreatePatchId;
  /**
   * The worker seam for schema validation. Defaults to an in-process
   * implementation so the prototype runs in one thread; a real
   * `postMessage`-backed one drops in without any store changing, because the
   * source and schema it needs are already arguments rather than reads.
   */
  schemaValidation?: SchemaValidationBridge;
  /**
   * Where stores report the work they do. Defaults to a sink that discards it,
   * so an uninstrumented run pays one returning method call per unit of work.
   *
   * Separate from the event buses on purpose — see `activity.ts`: nothing in the
   * system may react to a work record, and nothing does.
   */
  activity?: ActivitySink;
  /**
   * Where a patch's file bytes are POSTed, and where a removed file is deleted.
   *
   * Omitting it means this system refuses any patch carrying files, rather than
   * accepting one and dropping the bytes — see `PatchStore.createPatch`.
   */
  uploadFile?: UploadFile;
  /**
   * Where one `.jsonValues()` entry's content is fetched from (`GET /json`).
   *
   * Omitting it means this system cannot read INTO an entry: such a read reports
   * an error rather than `absent`, because "the content is not here" and "nobody
   * can fetch it" are different facts and only one of them is about the content.
   */
  fetchJsonEntry?: FetchJsonEntry;
  /**
   * Where a local patch is written back to (`PUT /patches`).
   *
   * Omitting it means this system never writes: edits stay local, and
   * `patchSync.currentState()` reports them pending forever. That is the honest
   * behaviour for a driver with no server (a benchmark, a test of the read path)
   * and it is deliberately not a silent success — an edit that reports itself
   * saved when nothing was written is the worst outcome available here.
   */
  savePatches?: SavePatches;
  /**
   * Bring the chain back in step after a 409. Required WITH `savePatches` to
   * make conflicts recoverable; without it a conflict retries against the same
   * parent and can only fail again.
   */
  resyncChain?: ResyncChain;
  /**
   * How long `publish` waits for local edits to reach the server.
   *
   * Defaults to {@link SAVE_FLUSH_TIMEOUT_MS}. Past it the publish refuses with
   * `unsaved-changes` rather than waiting on, because it has to answer the Save
   * button — see `publish`.
   */
  saveFlushTimeoutMs?: number;
  /** `POST /save`. Omitting it means this system cannot publish. */
  publishPatches?: PublishPatches;
  /** `DELETE /patches`. Omitting it means this system cannot discard. */
  discardPatches?: DiscardPatches;
  /**
   * Does a publish leave the patches on the server?
   *
   * `fs` applies the patches to the `.val` files and deletes them, so the client
   * must take them out of its chain and keep showing the value. `http` keeps them
   * server-side and re-applies them, so the chain must stay or the value would be
   * counted twice. Defaults to `fs`, which is dev — the mode a wrong guess is
   * cheapest in.
   */
  mode?: "fs" | "http";
  /** Attributes writes to this editing session. Metadata; nothing branches on it. */
  sessionId?: string | null;
  /** Retry backoff, injected so a test does not wait real seconds. */
  saveBackoffMs?: (attempt: number) => number;
  /** How the retry waits, injected for the same reason. */
  saveSleep?: (ms: number) => Promise<void>;
  /**
   * Where renders and custom `validate` closures are RUN.
   *
   * Defaults to the `HostStore` this function creates, which is what the Studio
   * uses: the host app hands its `ValModules` over and the real `select` and
   * `validate` closures run against live source.
   *
   * Supply one to answer from somewhere else. A Storybook story is the case that
   * exists: it has static renders and no `ValModules`, and without this its
   * fields would render with every render node missing — which is not what the
   * story is showing. Same shape of injection as `schemaValidation` and
   * `workerRealm`, and for the same reason: `HostBridge` is a seam, and
   * `HostStore` is one implementation of it.
   *
   * `system.host` is still the `HostStore` either way, because `host.receive` is
   * how modules get in and a bridge cannot take them. A caller that supplies a
   * bridge simply never calls it.
   */
  hostBridge?: HostBridge;
  /**
   * The worker realm. Defaults to the in-process stores.
   *
   * Supply these to move search, patch sets and references onto a real thread:
   * `createWorkerBridges(domEndpoint(new Worker(...)))` returns exactly this
   * shape. Nothing else in the system changes, which is the claim
   * `architecture.md` has been making about the realm split and
   * `workerBridge.test.ts` is what checks it — in an actual second thread.
   *
   * Two things do NOT cross and are lost when you do this: the worker stores'
   * events and their activity records, both of which are per-realm. See the
   * header of `workerBridge.ts`.
   */
  workerRealm?: {
    search: SearchBridge;
    patchSets: PatchSetBridge;
    references: ReferenceBridge;
  };
};

/**
 * In-process stand-in for the schema-validation worker.
 *
 * Async on purpose even though it resolves immediately: if any caller were
 * allowed to depend on it being synchronous, swapping in the real worker would
 * be a rewrite of that caller.
 */
class InProcessSchemaValidation implements SchemaValidationBridge {
  private validator = new SchemaValidator();
  async validate(
    moduleFilePath: ModuleFilePath,
    source: Source,
    serializedSchema: SerializedSchema,
    schemaVersion: string,
  ): Promise<ValidationErrors> {
    return this.validator.validate(
      moduleFilePath,
      source,
      serializedSchema,
      schemaVersion,
    );
  }
}

/**
 * Builds the store graph across both realms and wires it up.
 *
 * See `architecture.md` for the graph, the realm split, and the reasoning.
 *
 * Within a realm, stores talk by native `CustomEvent` on the emitting store's
 * own bus, plus plain synchronous READS (never mutations) — those are sync
 * precisely because the realm is shared. ACROSS the worker seam nothing is
 * observable, so the host side explicitly pushes: that is what the `listenTo`
 * calls at the bottom of this function are, and why they pass data rather than
 * store references.
 */
export function createSystem(options: SystemOptions): System {
  // --- host realm -----------------------------------------------------------
  const activity = options.activity ?? noopActivity;
  const schemaStore = new SchemaStore(activity);
  const patchStore = new PatchStore(
    options.fetchPatches,
    options.createPatchId,
    activity,
    options.uploadFile,
  );
  // No head callback: the source store owns its own revision now. The chain is
  // the patch store's business and cannot see a base-source replacement.
  const sourceStore = new SourceStore(
    schemaStore,
    activity,
    options.fetchJsonEntry,
  );
  const stat = new StatStore();
  const status = new StatusStore(activity);
  const patchSync = new PatchSync(
    patchStore,
    // Passed through as-is, including `undefined`: no write seam is a real
    // configuration (a benchmark, a read-path test) and `PatchSync` reports it
    // as `pending`. A stand-in that returned a retryable error instead would
    // spin a retry loop forever against a server that does not exist.
    options.savePatches,
    options.resyncChain ?? (async () => {}),
    activity,
    options.sessionId,
    options.saveBackoffMs,
    options.saveSleep,
  );
  // The parent of the next write, which the file upload needs and only
  // `PatchSync` knows. Wired here rather than passed to the constructor because
  // the sync is built after the store it drives.
  patchStore.setParentRefSource(() => patchSync.currentParentRef());
  const host = new HostStore(schemaStore, sourceStore, activity);
  const hostBridge = options.hostBridge ?? host;
  const renderStore = new RenderStore(
    hostBridge,
    sourceStore,
    schemaStore,
    activity,
  );
  const validationStore = new ValidationStore(
    schemaStore,
    sourceStore,
    options.schemaValidation ?? new InProcessSchemaValidation(),
    hostBridge,
    activity,
  );

  // --- worker realm ---------------------------------------------------------
  const searchStore: SearchBridge =
    options.workerRealm?.search ?? new SearchStore(activity);
  const patchSetStore: PatchSetBridge =
    options.workerRealm?.patchSets ?? new PatchSetStore(activity);
  const referenceStore: ReferenceBridge =
    options.workerRealm?.references ?? new ReferenceStore(activity);
  // Staleness is tracked HERE, on the host, not inside the worker-realm stores.
  // The host is the side that sees the change; keeping the set in the worker
  // meant pushing it in and reading it back, which across a thread boundary is
  // four messages for something already known. See `StaleModules`.
  const searchStale = new StaleModules("search:invalidate");
  const referenceStale = new StaleModules("references:invalidate");
  // What the grouping holds, and whether the next read can append to it. Host
  // side for the same reason `StaleModules` is: the host saw the change. See
  // `PatchSetChain` for why it is a prefix test rather than a list of moments.
  const patchSetChain = new PatchSetChain();
  /** One publish at a time. See `publish`. */
  let publishing = false;
  /**
   * `fs` by default — dev, and the mode a wrong guess is cheapest in. Replaced
   * by {@link System.setMode} once `/stat` says which one this really is.
   */
  let mode: "fs" | "http" = options.mode ?? "fs";
  /**
   * One grouping build at a time.
   *
   * `getPatchSets` plans against `PatchSetChain`, awaits the worker, and only
   * then records that the plan landed — so two callers arriving together both
   * planned the same `append` and both applied it, inserting every patch in the
   * suffix twice. Sharing the in-flight call gives concurrent readers one build
   * and one answer, which is what they wanted anyway.
   */
  let patchSetsInFlight: Promise<SerializedPatchSet> | null = null;
  // See `PatchStore.publishInFlight`: a stat landing mid-publish would otherwise
  // reconcile away the patches `/save` has just deleted server-side.
  patchStore.setPublishInFlight(() => publishing);

  /**
   * How many times each patch has been through {@link discardUnapplicable}.
   *
   * Not a "seen" set that silences it forever, which is what this was. A patch
   * can come BACK — the delete can fail, or a `PUT` already in flight can land
   * after it — and a patch in the chain that cannot apply holds the head at
   * `partial` and blocks every later save to its module. So a returning patch is
   * handled again, and the count is only there to stop an unbounded argument with
   * a server that will not let go.
   */
  const unapplicableAttempts = new Map<PatchId, number>();
  const UNAPPLICABLE_ATTEMPTS = 3;

  /**
   * Act on patches the apply refused. See the `source:patch-apply` listener.
   */
  async function discardUnapplicable(
    failed: readonly { patchId: PatchId; message: string }[],
  ): Promise<void> {
    const toDelete: PatchId[] = [];
    for (const { patchId, message } of failed) {
      const record = patchStore.recordsFor([patchId])[0];
      const moduleFilePath = record?.moduleFilePath;
      /**
       * "Cannot apply" is not reliably permanent, and assuming it was destroyed
       * a real edit.
       *
       * A module with `.jsonValues()` entries still unloaded is the case that
       * proved it: entry content is stitched in on read, so a patch INTO an entry
       * nobody has loaded fails against a marker — and would succeed once the
       * entry arrives. Reported, never deleted.
       */
      const uncertain =
        moduleFilePath !== undefined &&
        sourceStore.hasUnloadedEntries(moduleFilePath);
      const attempts = (unapplicableAttempts.get(patchId) ?? 0) + 1;
      unapplicableAttempts.set(patchId, attempts);

      console.error(
        uncertain
          ? "Val: a patch could not be applied, and this module still has " +
              "unloaded .jsonValues() entries — so it may apply once they " +
              "arrive. Keeping it. If the edit never appears, please report this."
          : "Val: discarding a patch that cannot be applied. If you see this " +
              "often, please report it — it means a patch is being generated " +
              "that does not fit the source it targets.",
        {
          patchId,
          reason: message,
          module: moduleFilePath ?? "(record already gone)",
          // The ops, not a count: which op at which path is the diagnosis.
          ops: record?.patch?.map((op) => ({
            op: op.op,
            path: "path" in op ? op.path : undefined,
          })),
          origin: patchStore.originOf(patchId),
          savedOnServer: !patchStore.isPending(patchId),
          attempt: attempts,
        },
      );
      if (uncertain) continue;
      if (attempts > UNAPPLICABLE_ATTEMPTS) {
        console.error(
          "Val: giving up on deleting an unapplicable patch — it keeps coming " +
            "back. It is out of this session's chain so it cannot block saving, " +
            "but it is still on the server.",
          { patchId, attempts },
        );
        patchStore.drop([patchId]);
        continue;
      }
      toDelete.push(patchId);
    }
    if (toDelete.length === 0) return;

    /**
     * Dropped locally FIRST, and synchronously.
     *
     * `PatchSync` drains what the chain holds, so taking the patch out now is
     * what stops it being offered to `PUT /patches` at all. The delete below is
     * for the case where that race was already lost.
     *
     * Not conditional on the delete succeeding: whatever the server says, a
     * chain holding a patch that can never apply keeps the head `partial` and
     * blocks every later save to its module.
     */
    patchStore.drop(toDelete);
    status.reportError(
      toDelete.length === 1
        ? "An edit could not be applied and has been discarded."
        : `${toDelete.length} edits could not be applied and have been discarded.`,
      "This usually means a patch was generated that does not fit the content it " +
        "targets. The browser console has the failing operation.",
    );
    if (options.discardPatches === undefined) {
      // Local-only: it will be back on the next reload, and the log says so.
      console.error(
        "Val: cannot delete the patch on the server — this system has no " +
          "discard seam. It will return on the next reload.",
        { patchIds: toDelete },
      );
      return;
    }
    const res = await options.discardPatches(toDelete);
    if (res.status === "error") {
      // Left for the next round: if the patch is still on the server it will be
      // announced again, fail again, and be attempted again — which is what the
      // attempt counter bounds.
      console.error(
        "Val: could not delete an unapplicable patch on the server.",
        { patchIds: toDelete, error: res.message },
      );
    }
  }

  /**
   * Coalesce the pass above, so typing costs one validation per burst.
   *
   * `patch:chain` fires on every chain movement, which for a field being typed
   * into is once per patch. Validating on each would put the whole
   * per-keystroke cost this design removed straight back — so the pass is
   * deferred and collapsed, and the timer is cleared on dispose so a torn-down
   * system cannot wake up and validate.
   */
  let validatePendingTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleValidationOfPendingModules(): void {
    if (validatePendingTimer !== null) return;
    validatePendingTimer = setTimeout(() => {
      validatePendingTimer = null;
      const modules = new Set<ModuleFilePath>();
      for (const record of patchStore.allRecords()) {
        modules.add(record.moduleFilePath);
      }
      for (const moduleFilePath of modules) {
        // Fire and forget: the result reaches readers as `validation:result`,
        // and a failure to validate is the validation store's to report.
        void validationStore.validate(moduleFilePath);
      }
    }, PENDING_VALIDATION_DEBOUNCE_MS);
  }

  const unsubscribe = [
    patchStore.listenTo(stat, sourceStore),
    sourceStore.listenTo(patchStore),
    // The write is the one path that is not demand-driven: a local patch has to
    // reach the server whether or not anything reads it again. So the sync
    // subscribes to `patch:create` and drives itself.
    patchSync.listenTo(),
    /**
     * A permanently refused patch has to reach the USER.
     *
     * This is the one outcome in the whole system that destroys local state
     * without being asked to: the server said 400, so the patch is dropped and
     * source is rebuilt without it — the alternative being a user staring at an
     * edit that will never exist anywhere. But then their edit is simply gone
     * from the screen, and nothing says why. Silently reverting what someone
     * typed is the worst thing this system can do, so it is reported.
     *
     * A transient error rather than a state, because the queue after the drop is
     * genuinely in-sync: there is nothing left to say about it, and a status that
     * meant "in sync, but something was thrown away" would be read as neither.
     * `StatusStore` errors are sticky until dismissed, which is the property a
     * rejection needs.
     */
    /**
     * Unpublished changes the server named and then did not send.
     *
     * Reported for the same reason a rejected save is: what is on screen is not
     * what the server says exists, and the person editing has no way to tell.
     * Anything they change now is written on top of content missing those edits.
     *
     * This is the visible half of the failure that motivated the patch store
     * rewrite - a studio told about 410 unpublished changes, sent 359, and left
     * waiting on the rest with nothing said. The store no longer produces that
     * disagreement; this makes sure that if anything ever does, it is not
     * silent.
     */
    /**
     * The server threw someone's unpublished changes away.
     *
     * It repairs its own store on read, so a change whose file it cannot use is
     * removed rather than kept to fail on every load. That is the right call —
     * but the fields then go quietly back to their published values, and finding
     * that out by noticing is the worst version of it.
     */
    stat.events.on("patch:removed-by-server", (event) => {
      status.reportError(
        event.removed.length === 1
          ? "An unpublished change was removed because the server could not read it."
          : `${event.removed.length} unpublished changes were removed because the server could not read them.`,
        "They are gone and the fields are back to their published values. The " +
          "server log and .val/patches/patches.repair.log say which, and why.",
      );
      console.error(
        "Val: the server removed these unpublished changes.",
        event.removed,
      );
    }),
    /**
     * The chain could not be READ, which is as bad as it not saving.
     *
     * Stat names the pending patches, so the editor knows they exist; without
     * their ops it renders published content instead. Nothing on screen
     * distinguishes that from the edits having been discarded, so it cannot be
     * left to the console — this is the one signal an editor has that what they
     * are looking at is not what the project holds.
     *
     * Sticky until dismissed, like every `StatusStore` error, and de-duplicated
     * by message there, so a retry loop that keeps failing says it once.
     */
    patchStore.events.on("patch:fetch-failed", (event) => {
      status.reportError(
        // Deliberately count-free, so the message is STABLE: `StatusStore`
        // de-duplicates by message, and a retry loop that fails on a different
        // number of patches each round would otherwise stack a fresh toast per
        // round. The count belongs to the occurrence, so it goes in the details.
        "Unpublished changes could not be loaded.",
        `${event.patches.length} ${
          event.patches.length === 1 ? "change is" : "changes are"
        } affected: ${event.message} Until this succeeds, the editor shows published content for the fields they touch.`,
      );
    }),
    patchStore.events.on("patch:announced-not-delivered", (event) => {
      status.reportError(
        event.patches.length === 1
          ? "An unpublished change could not be loaded."
          : `${event.patches.length} unpublished changes could not be loaded.`,
        "The server listed them but did not send them, so they are not shown. " +
          "Reload before editing: anything you change now is written on top of " +
          "content that is missing them.",
      );
      console.error(
        "Val: the server announced these unpublished changes and did not send them.",
        { patchIds: event.patches },
      );
    }),
    patchSync.events.on("patch:save-rejected", (event) => {
      status.reportError(
        event.patches.length === 1
          ? "An edit could not be saved and has been reverted."
          : `${event.patches.length} edits could not be saved and have been reverted.`,
        event.errors
          ? Object.entries(event.errors)
              .map(
                ([moduleFilePath, messages]) =>
                  `${moduleFilePath}: ${messages.join(", ")}`,
              )
              .join("\n")
          : event.message,
      );
    }),
    /**
     * A save that keeps failing has to reach the USER.
     *
     * The retry itself is right and continues — an edit must not be thrown away
     * because the network blinked — but it used to be entirely silent: nothing
     * read the sync's `retrying` state, so the status bar said "Saving…" for as
     * long as the fault lasted, and the reason the client already had went
     * nowhere. A save that can never succeed then looks exactly like a slow one.
     *
     * Sticky until dismissed, like every `StatusStore` error, and de-duplicated
     * by title there — which is why `describeStuckSave` keeps the attempt count
     * out of the title and in the detail.
     */
    patchSync.events.on("patch:save-stuck", (event) => {
      const report = describeStuckSave(
        event.reason,
        event.message,
        event.attempt,
        event.patches.length,
      );
      status.reportError(report.title, report.detail);
    }),
    // The parent ref is computed from stat, so the sync has to see every stat.
    // Read from the store rather than carried on the event, so the event stays
    // an announcement rather than becoming the API — see `currentBaseSha`.
    stat.events.on("stat:receive", (event) => {
      const baseSha = stat.currentBaseSha();
      if (baseSha === null) return;
      patchSync.receiveStat(baseSha, event.patches);
      // A stat can unblock a save that had no honest parent to name. Nothing
      // else would retry it: `patch:create` already fired and found no base.
      void patchSync.flush();
    }),
    renderStore.listenTo(),
    validationStore.listenTo(),

    /**
     * Every module with a PENDING CHANGE is validated, whether or not anyone is
     * looking at it.
     *
     * The rest of this system is demand-driven and should stay that way: nothing
     * validates a module because it exists. But "can this project be published"
     * is a question with no field behind it — the publish button asks it, and it
     * has to be answered about every pending change, including ones made in a
     * view that has since been closed, in another tab, or by the AI. Left to
     * on-screen demand it was answered from whatever happened to have been
     * looked at, which is how an invalid edit could sit in the chain with the
     * publish button offering to ship it.
     *
     * Bounded by the pending chain, not by the project: a project with three
     * edited modules validates three modules, however many it has. And bounded
     * again by `ValidationStore`'s own cache — a module whose source has not
     * moved since its last result is a cache hit, so a burst of unrelated chain
     * events costs nothing.
     */
    patchStore.events.on("patch:chain", () => {
      scheduleValidationOfPendingModules();
    }),

    /**
     * A patch that cannot be applied is deleted, and says so loudly.
     *
     * `failed` means `applyPatch` REFUSED the ops against the module's current
     * source — a `replace` at a path that is not there, an array index past the
     * end. It does not mean "not ready": a patch whose module has not loaded is
     * skipped and replayed by `receive()`, and a patch carrying only `file` ops
     * counts as applied. So everything reaching here is a patch that will fail
     * the same way on every future replay, forever.
     *
     * Leaving it in the chain is the worst of the options. It cannot contribute a
     * value, it makes the head permanently `partial`, and `PatchSync` keeps
     * offering it to `PUT /patches` — so one bad patch blocks every later edit to
     * that module from ever being saved. Deleting it costs the one edit it
     * carried; keeping it costs all the others.
     *
     * Deleted on the SERVER too, not just here. A local-only drop comes straight
     * back on the next reload, which is how a single bad patch turns into a
     * project that cannot be edited until someone finds `.val/patches` by hand.
     *
     * The `console.error` is the point of the whole thing being visible rather
     * than quiet: one is a mishap, a stream of them is a bug in patch generation
     * or in the apply, and the ops plus the module are what makes the difference
     * legible from a user's console.
     */
    sourceStore.events.on("source:patch-apply", (event) => {
      if (event.failed.length === 0) return;
      void discardUnapplicable(event.failed);
    }),

    // --- host-side staleness ----------------------------------------------
    // No longer a push ACROSS the seam: the host records what changed and keeps
    // it, so a query can decide what to gather without asking the worker
    // anything first.
    sourceStore.events.on("source:patch-apply", (event) => {
      searchStale.mark(event.modules);
      referenceStale.mark(event.modules);
    }),
    sourceStore.events.on("source:init", (event) => {
      searchStale.mark(event.sources);
      referenceStale.mark(event.sources);
    }),

    // --- patch-set invalidation -------------------------------------------
    // A schema replaced under patches that are otherwise untouched. The prefix
    // test cannot see this — the ids are identical — and it matters because patch
    // sets are grouped using the schema at the op's path, so what is already
    // inserted was grouped against a schema that no longer exists.
    schemaStore.events.on("schema:init", () => {
      patchSetChain.invalidate();
    }),
    // A drop is the other case the ids DO show — the chain shrank, so the prefix
    // test would rebuild anyway. Invalidating explicitly costs nothing and means
    // the guarantee does not rest on the chain happening to get shorter: a drop
    // of the last patch followed by a new one is the same LENGTH as before.
    patchStore.events.on("patch:drop", () => {
      patchSetChain.invalidate();
    }),
  ];

  /**
   * Turn a plan into the payload it needs, and nothing more.
   *
   * The records are filtered to the ids the plan named, and the schemas to the
   * modules THOSE records touch. Both matter: the caller used to send the whole
   * chain and `schemaStore.all()` on every read — every module in the project, to
   * group patches that usually touch one — which is why this was the worst row in
   * the worker-seam benchmark.
   */
  function patchSetRequest(
    plan: PatchSetPlan,
    chain: PatchRecord[],
  ): PatchSetRequest {
    if (plan.mode === "current") {
      return { mode: "current" };
    }
    const wanted = new Set(plan.patchIds);
    const records = chain.filter((record) => wanted.has(record.patchId));
    const allSchemas = schemaStore.all();
    const schemas: Record<ModuleFilePath, SerializedSchema> = {};
    for (const record of records) {
      const schema = allSchemas[record.moduleFilePath];
      // A module with no schema is passed as absent rather than skipped:
      // `PatchSets.insert` handles `undefined` deliberately, grouping the patch
      // at the module root instead of dropping it.
      if (schema !== undefined) {
        schemas[record.moduleFilePath] = schema;
      }
    }
    activity.work("patch-set:gather", undefined, records.length);
    return { mode: plan.mode, records, schemas };
  }

  /**
   * Copy source + schema for the named modules, to hand across the worker seam.
   *
   * The one place the system copies module source, so it is counted with the
   * number of modules it touched: "how much of the project got gathered, and how
   * often" is the question this instrumentation exists to answer.
   */
  function gatherSnapshot(modules: ModuleFilePath[]): SourceSnapshot {
    const schemas = schemaStore.all();
    const snapshot: SourceSnapshot = {};
    activity.work("search:gather-snapshot", undefined, modules.length);
    for (const moduleFilePath of modules) {
      const schema = schemas[moduleFilePath];
      const source = sourceStore.moduleSource(moduleFilePath);
      // A module without a schema cannot be walked — the walk is schema-driven.
      // Skipping keeps it out of `all`, so it reads as not-indexed rather than
      // as indexed-and-empty.
      if (schema === undefined || source === undefined) continue;
      snapshot[moduleFilePath] = {
        source,
        schema,
        // Asked HERE, on the host side, because this is the last point at which
        // it can be: the search store is across the worker seam and cannot ask
        // the source store anything.
        complete: !sourceStore.hasUnloadedEntries(moduleFilePath),
      };
    }
    return snapshot;
  }

  /**
   * Bring the reference index up to date, then answer from it.
   *
   * Shared by both reference entry points so the scan-then-read pair cannot
   * drift: an `at()` served from a stale index reports what a field USED to
   * point at, which is the same class of bug as a stale referrer blocking a
   * safe delete.
   */
  async function rescanReferences(): Promise<void> {
    if (!referenceStale.needsPass()) {
      return;
    }
    // Only what the index owes a pass for. On a first query that is every loaded
    // module; after an edit it is the one module that changed. Decided here, from
    // host state, so a real seam is crossed once rather than four times.
    const target = referenceStale.target(sourceStore.loadedModules());
    const scanned = await referenceStore.rescan(
      gatherReferenceSnapshot(target),
    );
    // Marked covered from what the worker actually scanned, not from what was
    // asked for: a module it skipped (no schema, no source) must stay stale or it
    // never gets another chance.
    referenceStale.covers(scanned);
  }

  function gatherReferenceSnapshot(
    modules: ModuleFilePath[],
  ): ReferenceSnapshot {
    const schemas = schemaStore.all();
    const snapshot: ReferenceSnapshot = {};
    for (const moduleFilePath of modules) {
      const schema = schemas[moduleFilePath];
      const source = sourceStore.moduleSource(moduleFilePath);
      if (schema === undefined || source === undefined) continue;
      snapshot[moduleFilePath] = {
        source,
        schema,
        complete: !sourceStore.hasUnloadedEntries(moduleFilePath),
      };
    }
    return snapshot;
  }

  return {
    host,
    stat,
    status,
    schemaStore,
    sourceStore,
    patchStore,
    patchSync,
    renderStore,
    validationStore,
    searchStore,
    patchSetStore,
    referenceStore,
    async findReferences(query) {
      await rescanReferences();
      return referenceStore.find(query);
    },
    async referenceAt(path) {
      await rescanReferences();
      return referenceStore.at(path);
    },
    async getPatchSets() {
      if (patchSetsInFlight !== null) {
        return patchSetsInFlight;
      }
      const run = (async () => {
        // `allRecords()`, so the chain compared against is the patches whose OPS
        // have arrived — not `ordered`, which can name an announced patch this
        // client has never seen the contents of. Using `ordered` would ask for a
        // rebuild carrying a record that does not exist yet; using this means a
        // foreign patch announced mid-chain reads as `current` until its data
        // lands, and as a rebuild the moment it does.
        const chain = patchStore.allRecords();
        const plan = patchSetChain.plan(chain.map((record) => record.patchId));
        const request = patchSetRequest(plan, chain);
        const sets = await patchSetStore.getPatchSets(request);
        // AFTER the call, not before: a worker that threw or a message that was
        // never answered must not leave the host believing the grouping moved.
        patchSetChain.covers(plan);
        return sets;
      })().finally(() => {
        patchSetsInFlight = null;
      });
      patchSetsInFlight = run;
      return run;
    },
    async search(query, limit, offset) {
      // Gather ONLY what the index owes a pass for. On a first query that is
      // every loaded module; after an edit it is the one module that changed.
      // The gather is the whole-project copy, so scoping it here is the point:
      // one edit then one query used to clone and re-walk the entire project.
      if (searchStale.needsPass()) {
        const target = searchStale.target(sourceStore.loadedModules());
        const indexed = await searchStore.reindex(gatherSnapshot(target));
        searchStale.covers(indexed.all);
      }
      const found = await searchStore.search(query, limit, offset);
      if (found.status === "no-index") {
        return found;
      }
      // Joined here, at the realm boundary: the worker's answer plus what the
      // host knows about staleness. Neither side has to interrogate the other.
      return { ...found, staleModules: searchStale.staleModules() };
    },
    async buildSearchIndex() {
      const loaded = sourceStore.loadedModules();
      const result = await searchStore.buildIndex(gatherSnapshot(loaded));
      searchStale.covers(result.all);
      return result;
    },
    /**
     * `requestedPatchIds` is the CALLER's view of the chain, not the set that
     * gets published.
     *
     * The studio reads it from the server's list, which by the time Save is
     * clicked can be missing a patch the user has just typed — a field writes on
     * a pause. What is published is the pending chain after everything local has
     * been saved, which is also the source the gate below validates. Publishing
     * the caller's list instead is how a project ships without its newest edit,
     * or ships a broken patch whose fix was still local.
     */
    async publish(requestedPatchIds, message) {
      void requestedPatchIds;
      if (options.publishPatches === undefined) {
        return {
          status: "failed",
          message: "This system has no publish seam configured.",
          retryable: false,
        };
      }
      if (publishing) {
        // Two publishes of overlapping patches is a race whose loser publishes
        // ids the winner has already consumed. Refused rather than queued: a
        // second publish is a second click, and the honest answer is "one is
        // already running".
        return { status: "refused", reason: "already-publishing" };
      }
      publishing = true;
      try {
        /**
         * Everything typed reaches the server BEFORE anything is decided.
         *
         * A field writes on a pause, so at the moment Save is clicked the last
         * word may still be a local patch the server has never seen — and the
         * caller's `patchIds` came from the SERVER's list, so it does not
         * include it. Publishing that list would ship the project without the
         * last thing the user typed, while the validation below — which reads
         * local source — would have been about a document including it.
         */
        if (
          options.savePatches !== undefined &&
          patchStore.unsavedRecords().length > 0
        ) {
          /**
           * Bounded, because `flush` is not.
           *
           * `PatchSync.drain` retries a failed save for as long as the network is
           * down — which is right for the sync and fatal here: awaiting it would
           * leave Save spinning forever with no way to say why. And if the sync
           * is ALREADY retrying, the answer is known: the server cannot be
           * reached, so there is nothing to wait for.
           */
          if (patchSync.currentState().status !== "retrying") {
            await Promise.race([
              patchSync.flush().catch(() => undefined),
              new Promise<void>((resolve) => {
                const timer = setTimeout(
                  resolve,
                  options.saveFlushTimeoutMs ?? SAVE_FLUSH_TIMEOUT_MS,
                );
                // Node keeps the process alive for a pending timer; nothing here
                // needs it to.
                if (typeof timer === "object" && "unref" in timer) {
                  timer.unref();
                }
              }),
            ]);
          }
        }
        // Only where a save is possible at all. A system with no save seam holds
        // patches that are local by definition — there is nothing to wait for,
        // and refusing would make publish unreachable rather than safe.
        const stillUnsaved =
          options.savePatches === undefined ? [] : patchStore.unsavedRecords();
        if (stillUnsaved.length > 0) {
          // The flush could not get everything up. Refused rather than
          // published-in-part: the alternative publishes a chain whose tail is
          // missing, and the tail is the newest edit.
          return {
            status: "refused",
            reason: "unsaved-changes",
            patchIds: stillUnsaved.map((record) => record.patchId),
          };
        }

        /**
         * The chain as it is NOW, which is what the validation below is about.
         *
         * Not the list the caller captured: it was taken before the flush, and
         * the point of the gate is that the patches validated and the patches
         * published are the same set. The server's chain is linear, so "the
         * pending chain" is the only meaningful thing to publish anyway —
         * publishing a proper subset would mean committing a patch while keeping
         * an earlier one pending.
         */
        const toPublish = patchStore
          .allRecords()
          .map((record) => record.patchId);
        if (toPublish.length === 0) {
          return { status: "nothing-to-publish" };
        }

        // Validate the affected modules, and validate them rather than reading
        // what is cached. The engine's own comment explains why: custom
        // validators run on their own module's change, so a module edited before
        // a validator existed — or edited in another session — has never had them
        // run. Reading a cached result would make the gate recent rather than
        // complete.
        const affected = new Set<ModuleFilePath>();
        for (const record of patchStore.recordsFor(toPublish)) {
          affected.add(record.moduleFilePath);
        }
        /**
         * Proof that nothing moved while the gate ran.
         *
         * Validation is asynchronous — a worker, and possibly the user's own
         * `validate` closures — so an edit can land while it runs, and the
         * answer would then be about a document that is not the one being
         * published. Compared after the loop below, and the whole gate is redone
         * if it moved.
         */
        const chainAt = patchStore.chainVersion();
        const invalid: ModuleFilePath[] = [];
        for (const moduleFilePath of affected) {
          const result = await validationStore.validate(moduleFilePath);
          if (result.status !== "validated" || result.errors === false) {
            continue;
          }
          /**
           * Filtered, not counted raw — and this was a real regression, caught
           * by driving the Save button in a browser rather than by any test.
           *
           * `router:check-route` and `keyof:check-keys` reach here unresolved,
           * carrying the message "should typically be processed by Val
           * internally... you have a Val version mismatch". Every route module
           * in a project has them. Gating on the raw errors therefore refused
           * every publish, with nothing showing an error anywhere on screen,
           * because the UI runs its errors through this same filter before
           * displaying them. A gate and a display that disagree about what an
           * error is, is a Save button that does nothing and cannot say why.
           */
          const blocking = filterBlockingValidationErrors(
            result.errors,
            schemaStore.all(),
            sourceStore.allSources(),
          );
          if (Object.keys(blocking).length > 0) {
            invalid.push(moduleFilePath);
          }
        }
        if (invalid.length > 0) {
          return {
            status: "refused",
            reason: "validation-errors",
            modules: invalid,
          };
        }
        if (patchStore.chainVersion() !== chainAt) {
          // An edit landed while the gate was running, so what was just checked
          // is not what would be published. Refused, and retryable: the caller
          // clicks Save again — or the UI does — and the gate runs against the
          // chain that now exists. Passing this through would be the exact
          // failure the gate is for, one race narrower.
          return {
            status: "refused",
            reason: "chain-moved",
          };
        }

        const outcome = await options.publishPatches({
          patchIds: toPublish,
          message,
        });
        if (outcome.status === "patch-errors") {
          // Recorded, not just returned. A server refusal never resolves itself,
          // so the publish gate has to keep seeing it after the caller that made
          // this call has gone — see `PatchStore.publishErrors`.
          patchStore.recordPublishErrors(outcome.errors);
          return {
            status: "failed",
            message: outcome.message,
            patchErrors: outcome.errors,
            retryable: false,
          };
        }
        if (outcome.status !== "published") {
          return {
            status: "failed",
            message: outcome.message,
            // A 409 means someone else committed first, which is retryable once
            // this client has caught up. A network error says nothing about
            // whether the publish happened, which is also retryable — and is why
            // `/save` has to be idempotent in the patch ids it is given.
            retryable:
              outcome.status === "not-fast-forward" ||
              outcome.status === "network-error",
          };
        }

        // Recorded before the mode split, because it is true in both: these
        // patches are in a commit now. `filePatchIds` needs it in `http` mode,
        // where the chain keeps them — see `PatchStore.publishedIds`.
        patchStore.markPublished(toPublish);
        if (mode === "fs") {
          // ORDER MATTERS, and this is the whole reason both methods exist.
          // Promote first: the patched value becomes the base, so when the chain
          // goes the displayed value does not move. Reversed, every published
          // field would flash back to its pre-publish text until the next source
          // fetch landed.
          sourceStore.promoteToBase([...affected]);
          sourceStore.forgetPublished(toPublish);
          patchStore.forgetPublished(toPublish);
        }
        // In `http` mode the patches stay server-side and are re-applied, so the
        // chain stays too — removing it would show the value without them until
        // the next fetch, and promoting the base would then double-apply.
        // The ids that were actually published, which is what the caller has to
        // forget — it asked with a list taken before the flush.
        return { status: "published", patchIds: toPublish };
      } finally {
        publishing = false;
      }
    },
    async discard(patchIds) {
      if (options.discardPatches === undefined) {
        return {
          status: "failed",
          message: "This system has no discard seam configured.",
        };
      }
      const res = await options.discardPatches(patchIds);
      if (res.status === "error") {
        return { status: "failed", message: res.message };
      }
      // The ids the SERVER says it deleted, not the ids we asked about: a partial
      // delete must not make the client forget a patch that still exists.
      patchStore.drop(res.patchIds);
      return { status: "discarded" };
    },
    patchErrors() {
      return patchStore.publishErrors();
    },
    setMode(next) {
      mode = next;
    },
    dispose() {
      for (const off of unsubscribe) off();
      if (validatePendingTimer !== null) {
        clearTimeout(validatePendingTimer);
        validatePendingTimer = null;
      }
      // Before the unsubscribes would be wrong-ish and after is right: a retry
      // mid-backoff has to be told to stop, or it wakes up and writes to a
      // torn-down system — in a test, after the test that made it has finished.
      patchSync.dispose();
    },
  };
}

/**
 * Intake, kept as a free function so the entry point reads the same as the real
 * app's: the host app owns the modules and hands them in.
 *
 * `HostStore.receive` is what actually does it — this only names the boundary.
 */
export function receiveModules(
  system: System,
  modules: ValModule<SelectorSource>[],
): void {
  system.host.receive(modules);
}

/** Re-exported so `SourceSnapshot`'s shape is visible from the system module. */
export type { SourceSnapshot, ReferenceSnapshot };
