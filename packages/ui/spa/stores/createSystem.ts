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
import { filterBlockingValidationErrors } from "@valbuild/shared/internal";
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
import {
  PatchSync,
  type ResyncChain,
  type SavePatches,
  type PatchGroupResolver,
} from "./PatchSync";
import { HostStore } from "./HostStore";
import {
  indexPatchSets,
  stageClosure,
  unstageClosure,
  validateGroup,
  type PatchSetIndex,
  type PrefixViolation,
} from "../utils/patchGroups";
import { PreviewStore } from "./PreviewStore";
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
  PublishOptions,
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
 * How the pending-validation pass is deferred. Returns a cancel.
 *
 * A seam rather than a bare `setTimeout` because the property worth testing —
 * a burst of keystrokes arms ONE pass — is about arming, not about elapsed
 * time. Reaching for the global clock left the tests only one lever: race 40
 * awaited writes against the 300ms window and assert nothing fired yet. That
 * passes with roughly a 3x margin on an idle box, which is not a margin anyone
 * chose and not a property of this system; it went red on a CI runner.
 *
 * Injecting only THIS timer, rather than reaching for `jest.useFakeTimers()`:
 * a global fake clock also freezes `setTimeout(..., 0)`, which `testSystem`'s
 * `settle()` and every async seam in the rig are built on. The one timer under
 * test is controllable; the rest of the event loop stays real.
 */
export type DeferPendingValidation = (run: () => void) => () => void;

/**
 * How much of the chain a caller that named a set may publish.
 *
 * The longest prefix of `chain` that is both named and already on the server.
 * A PREFIX, never an arbitrary subset: committing a patch while an earlier one
 * stays pending would write a file that no ordering of what is left can
 * explain. Stopping early is always safe — the rest is a chain on top of a base
 * that moved, and it goes in the next round.
 */
export function takeNamedPrefix(
  chain: readonly PatchId[],
  named: ReadonlySet<PatchId>,
  unsaved: ReadonlySet<PatchId>,
): PatchId[] {
  const prefix: PatchId[] = [];
  for (const patchId of chain) {
    if (!named.has(patchId) || unsaved.has(patchId)) {
      break;
    }
    prefix.push(patchId);
  }
  return prefix;
}

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
  previewStore: PreviewStore;
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
     * Scope this client to a patch group: what it renders and what it publishes.
     *
     * One call sets both, because the two must not be able to disagree —
     * publishing something the editor was never shown is the failure this whole
     * feature exists to prevent, and two setters is how that happens.
     *
     * `null` is unscoped: every pending patch renders and publishes, which is
     * what this system did before groups existed, and is what fs mode and a
     * content API without patch groups stay on. `[]` is a real and different
     * answer — a group holding nothing, so the studio shows base.
     *
     * The ids are the group's FULL membership, closure included. This does not
     * compute the closure: that needs patch sets, which need the schema, and it
     * is `utils/patchGroups.ts` that owns it. Handing a set that breaks the
     * prefix invariant will publish a set that breaks it.
     */
    setPatchGroup(patchIds: readonly PatchId[] | null): void;
    /**
     * Register who can answer "which group does this write join".
     *
     * The closure needs patch sets, which need the schema, and the write path
     * can see neither — so whatever holds that knowledge registers itself here.
     * See {@link PatchGroupResolver}.
     *
     * `undefined` clears it, and writing without a group is exactly what this
     * client did before groups existed.
     */
    /**
     * Scope to what the server says this user's group holds, keeping whatever
     * this tab has written since. See the implementation for why the union is
     * not optional.
     */
    seedPatchGroup(ids: readonly PatchId[]): void;
    setPatchGroupResolver(resolver: PatchGroupResolver | undefined): void;
    /**
     * Tell the system which patch group is this client's.
     *
     * Resolving that needs the author id and the chain annotation, neither of
     * which these stores see — `useCurrentPatchGroup` is where the decision
     * lives. `publish` needs the answer so it can tell the content API which
     * group a commit empties, and the content API closes what it is told
     * without checking, so getting this wrong closes a group that still holds
     * somebody's unpublished work.
     */
    setOwnPatchGroupId(patchGroupId: string | undefined): void;
    /**
     * The closure for a write: which OTHER patches must join this author's
     * group so it stays prefix-closed.
     *
     * On the system because it needs an AWAITED grouping — see the
     * implementation for why answering from already-rendered patch sets makes
     * the closure empty in the normal case. A caller registering a resolver
     * should delegate to this rather than computing it themselves.
     */
    computeWriteClosure(patchIds: readonly PatchId[]): Promise<PatchId[]>;
    /**
     * The forward closure of a DISCARD: which other patches must lose their
     * group membership because these are being deleted.
     *
     * See the implementation. Sent to the content API as `unstagePatchIds`
     * — the name is the content API's, kept identical here so there is one
     * thing to grep for across both repos.
     */
    computeDiscardClosure(patchIds: readonly PatchId[]): Promise<PatchId[]>;
    /**
     * Persist a change to what this user's group holds.
     *
     * Separate from {@link System.setPatchGroup}, which only scopes THIS client.
     * A stage that is not persisted is lost on reload — and for an unstage that
     * is the dangerous direction, because the change silently comes back staged
     * and the next publish ships what the user meant to hold.
     */
    stagePatches(
      request: Parameters<StagePatches>[0],
    ): ReturnType<StagePatches>;
    unstagePatches(
      request: Parameters<StagePatches>[0],
    ): ReturnType<StagePatches>;
    /**
     * Send a group change, or hold it until there is a group to send it to.
     *
     * `patchGroupId` is `undefined` whenever this author has no open group:
     * before their first write on a branch, and again after every publish,
     * because a publish closes the group and the next one is created by the
     * next write. The review screen is usable in both windows — unstaging
     * somebody else's patch, or re-staging one held earlier — and every such
     * change used to reach only the local scope and then be lost on reload.
     *
     * Held on the SYSTEM rather than in the review screen, because the screen
     * unmounts the moment the user navigates off it to make the write that
     * creates the group. A queue that lives on the screen is a queue that is
     * gone before it can be flushed.
     */
    persistPatchGroupChange(
      patchGroupId: string | undefined,
      change: PatchGroupChangeRequest,
    ): void;
    /**
     * Send everything {@link System.persistPatchGroupChange} held back.
     *
     * Called when a group id appears. In chain order of the user's clicks: the
     * server unions on stage and removes on unstage, so replaying the moves in
     * the order they were made lands on the membership the user asked for, even
     * when they toggled the same patch twice.
     */
    flushPatchGroupChanges(patchGroupId: string): void;
    /** The current group, or `null` when unscoped. See {@link System.setPatchGroup}. */
    patchGroup(): readonly PatchId[] | null;
    /**
     * Commit patches, if they are publishable.
     *
     * On the system because it is the one operation that needs three stores at
     * once: validation decides whether it may happen, patches say what is being
     * published, and source has to be left showing the right thing afterwards.
     */
    publish(
      patchIds: PatchId[],
      message?: string,
      options?: PublishOptions,
    ): Promise<PublishResult>;
    /**
     * Validate every loaded module, announcing start and finish.
     *
     * A second call while one is running is a no-op rather than a queue: the
     * answer the first one produces is the answer the second one wanted.
     */
    validateEverything(): Promise<void>;
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

/**
 * Change what a patch group holds — stage, or unstage.
 *
 * The ids are already CLOSED by the caller: staging carries the prefix closure
 * over each patch set, unstaging the forward closure. Neither is derived here,
 * for the reason the closure is never derived server-side — it needs the
 * schema, and one implementation of that rule is the point.
 */
export type StagePatches = (request: {
  patchGroupId: string;
  /** What the user asked for. */
  patchIds: PatchId[];
  /**
   * What has to come with it, because the patches asked for are written on top
   * of it.
   *
   * The content API stores each membership row as `explicit` or `dependency`
   * and treats what it is not told about as `dependency`. Folding the two
   * halves into one list therefore files the patch somebody clicked as one the
   * closure dragged in — the only record anywhere of what the author chose, and
   * read backwards.
   */
  withPatchIds: PatchId[];
}) => Promise<{ status: "ok" } | { status: "error"; message: string }>;

/**
 * One move of this author's group, as it goes on the wire.
 *
 * Named because it is also what gets QUEUED when the group does not exist yet —
 * see {@link System.persistPatchGroupChange}.
 */
/**
 * How many un-persistable group changes to remember.
 *
 * Only reached on a branch where the group never comes into existence, which
 * means the user never writes — so this is a bound on a pathological session,
 * not a working one.
 */
const MAX_DEFERRED_GROUP_CHANGES = 100;

export type PatchGroupChangeRequest = {
  type: "stage" | "unstage";
  /** What the user asked for. */
  patchIds: PatchId[];
  /** What has to move with it. See {@link StagePatches}. */
  withPatchIds: PatchId[];
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
   * How the pending-validation pass is deferred. Defaults to a
   * `PENDING_VALIDATION_DEBOUNCE_MS` debounce — see `DeferPendingValidation`
   * for why this is an argument at all.
   */
  deferPendingValidation?: DeferPendingValidation;
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
  /**
   * `PUT` / `DELETE /patch-groups/~/patches` — stage and unstage.
   *
   * Omitting them means this system cannot change group membership, which is
   * every system without patch groups: `fs`, and any content API that predates
   * them. The staging UI stays off there rather than offering controls that
   * cannot do anything.
   */
  stagePatches?: StagePatches;
  unstagePatches?: StagePatches;
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
  const previewStore = new PreviewStore(
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
   * The patch group: which pending patches are THIS user's to see and publish.
   *
   * `null` means unscoped — fs mode, or a content API without patch groups —
   * and everything pending applies and publishes, which is what this system did
   * before groups existed. An empty array is a real, different answer: a group
   * holding nothing.
   *
   * Held here rather than in `SourceStore` because two stores need the same
   * answer and neither owns it. Source needs it to decide what the studio and
   * the preview render; publish needs it to decide what ships. Letting them
   * hold it separately is how they come to disagree, and the two disagreeing is
   * precisely the bug this feature exists to prevent — publishing something the
   * editor was never shown.
   */
  let patchGroupIds: readonly PatchId[] | null = null;
  /**
   * Which group is this client's, as the shell resolved it.
   *
   * Held rather than derived because resolving it needs the author id, which
   * lives in `/stat` and never reaches these stores — see
   * `useCurrentPatchGroup`, which weighs the save response against the chain
   * annotation and is the one place that decision is made. This is only its
   * answer, kept where `publish` can read it.
   */
  let ownPatchGroupId: string | undefined;
  /**
   * Group changes made while this author had no open group. See
   * {@link System.persistPatchGroupChange}.
   */
  let deferredGroupChanges: PatchGroupChangeRequest[] = [];

  /**
   * Does committing exactly these patches leave this client's group empty?
   *
   * The content API closes the group a commit names, and closes it WITHOUT
   * checking that the commit shipped all of it — so naming a group that still
   * holds work would take those patches out of every group and leave their
   * author unable to publish them. This is therefore the conservative
   * direction: unsure means no, and the cost of a false negative is only that
   * the group stays open and its id is reused.
   *
   * A member already shipped does not keep the group open. A publish leaves its
   * patches in the chain with `appliedAt` set until the deploy lands, and the
   * content API drops applied ids from every group anyway, so a scope carrying
   * one is describing something that is no longer the group's to hold.
   */
  function emptiesOwnPatchGroup(toPublish: readonly PatchId[]): boolean {
    if (ownPatchGroupId === undefined) return false;
    if (patchGroupIds === null) return false;
    /*
     * The SERVER's account of the group as well as this tab's scope.
     *
     * The scope is seeded once and then grows only on this tab's own writes, so
     * the same author writing or staging from a second tab adds ids the
     * annotation knows about and the scope never will. Deciding from the scope
     * alone passed this check on a group that still held unshipped work — and
     * the content API closes what it is named without looking, so those patches
     * fell into a closed group and out of the next one, and the other tab's
     * next stage into that id got a 409.
     *
     * An ABSENT annotation is treated as no additional members rather than as a
     * refusal, and that is the deliberate half. Refusing without it sounds
     * safer and is not: on a single-author branch nothing is ever missing from
     * the chain, so no fetch is made, so no annotation ever arrives — and the
     * group would then never close on exactly the branches where it matters
     * most. That is the bug the `patchGroupId` field was added to fix.
     *
     * What is left is narrow, because the case that worries us mostly brings
     * the annotation with it: a patch written in another tab is a MISSING id
     * here, so the chain fetch that pulls it in carries the groups too. The
     * residual is another tab STAGING an id this chain already has, with no
     * fetch to trigger — recorded in `DESIGN.md`.
     */
    const annotated = patchStore
      .groups()
      ?.find((group) => group.patchGroupId === ownPatchGroupId);
    const accountedFor = new Set([
      ...patchGroupIds,
      ...(annotated?.patchIds ?? []),
    ]);
    /*
     * `pendingAmong` is the store's one answer to "has this shipped", and it is
     * used here rather than restated. The predicate was written out at both
     * this call site and `markPublished`'s annotation close, and the two
     * disagreed the moment a member could be applied by somebody else's
     * publish: this one closed the group on the server, that one left the
     * annotation saying it was open, and every stage afterwards 409'd.
     *
     * It also answers the third state neither of them had. An id in the scope
     * or the annotation with no record left is GONE — discarded, or deployed
     * away — not pending, so one discard of a staged patch no longer leaves the
     * group unclosable for the rest of the session.
     */
    const shipping = new Set(toPublish);
    return [...patchStore.pendingAmong(accountedFor)].every((patchId) =>
      shipping.has(patchId),
    );
  }

  /**
   * Which OTHER patches must lose their group membership when these are deleted.
   *
   * Deleting a patch out of the middle of a patch set leaves every group that
   * still holds the rest with a non-prefix intersection — and a prefix is the
   * one invariant a group has, because the patches after the hole were written
   * against a view that had it. The patches at risk are the ones built on top,
   * which is the forward closure, and deriving it needs the schema: the content
   * API cannot compute it, so the client sends it.
   *
   * Returns only the OTHERS. The deleted patches lose their memberships by
   * cascade on the content side; naming them again would be noise.
   *
   * `[]` on any failure. This rides along with a delete that is going to happen
   * regardless, so a closure that cannot be computed must not take the discard
   * down with it — the cost is a group left holding a suffix, which `publish`
   * refuses and names, rather than a discard that silently does nothing.
   */
  async function computeDiscardClosure(
    patchIds: readonly PatchId[],
  ): Promise<PatchId[]> {
    if (patchIds.length === 0) return [];
    if (!patchStore.patchGroupsSupported()) {
      /*
       * No groups on this deployment, so there are no memberships to repair and
       * `ValOpsFS.deletePatches` ignores the answer. Without this, every discard
       * paid for a full worker patch-set build that nobody read — on a long
       * chain, that is the delay before anything is deleted.
       *
       * NOT `patchGroupIds === null`, which is the condition
       * `computeWriteClosure` uses and would be wrong here. That one asks "do I
       * have a group to keep closed", and an unscoped client has none. This
       * asks whether ANYONE does — a client that has not been scoped yet, in
       * the window before the annotation arrives, is unscoped and other
       * people's groups exist regardless. Skipping there would let a discard in
       * that window leave them holding a suffix.
       */
      return [];
    }
    try {
      const chain = patchStore.allRecords().map((record) => record.patchId);
      const index = indexPatchSets(await computePatchSets(), chain);
      /*
       * Run against the WHOLE chain rather than against this client's group.
       *
       * What is being computed is not "what leaves my group" but "what can no
       * longer be a member of any group anywhere", and the answer is the same
       * set whoever is asking. Scoping it to the local group would name only
       * the part this author happens to hold and leave everybody else's group
       * holding the suffix — the exact thing this exists to prevent.
       */
      const surviving = unstageClosure(index, new Set(chain), patchIds);
      const discarded = new Set(patchIds);
      return chain.filter(
        (patchId) => !surviving.has(patchId) && !discarded.has(patchId),
      );
    } catch {
      return [];
    }
  }

  /** One stage or unstage, on the wire. Failures are logged, not thrown. */
  async function sendPatchGroupChange(
    patchGroupId: string,
    change: PatchGroupChangeRequest,
  ): Promise<void> {
    const call =
      change.type === "stage" ? options.stagePatches : options.unstagePatches;
    if (call === undefined) {
      // No seam configured, which is `fs` mode: membership is local truth
      // there, and the local scope has already moved.
      return;
    }
    const res = await call({
      patchGroupId,
      patchIds: change.patchIds,
      withPatchIds: change.withPatchIds,
    });
    if (res.status === "error") {
      /*
       * KNOWN GAP: nothing puts the local scope back.
       *
       * `PatchStore` re-reads the group annotation only inside a fetch it makes
       * for MISSING patch ids, so on a quiet branch the request that would
       * correct the screen may never happen — the user keeps seeing a stage the
       * server refused until they reload. Same root cause as a stage in one tab
       * not reaching another. See `docs/independent-publish/DESIGN.md`.
       */
      console.error("Val: could not update patch group", res.message);
    }
  }

  /**
   * Widen the scope to include these patches, keeping both halves in step.
   *
   * The scope means "my group", and there are two ways a patch joins one
   * without anybody touching a staging control:
   *
   * - this client WROTE it. The server puts a new patch in its author's open
   *   group unconditionally, so a scope that did not grow with it would hide
   *   the author's own typing behind their own filter;
   * - it is in the CLOSURE of something this client wrote. The write path sends
   *   `withPatchIds` and the server unions them in, so those patches are in
   *   the group on the server whether or not this client is showing them — and
   *   not showing them is the exact failure this feature exists to prevent:
   *   publishing a set the editor was never shown.
   *
   * A no-op when unscoped (`null` — fs mode, or a content API without groups),
   * where everything is visible already.
   */
  function extendPatchGroup(patchIds: readonly PatchId[]): void {
    if (patchGroupIds === null) {
      return;
    }
    const next = new Set(patchGroupIds);
    let grew = false;
    for (const patchId of patchIds) {
      if (next.has(patchId)) continue;
      next.add(patchId);
      grew = true;
    }
    if (!grew) {
      return;
    }
    patchGroupIds = [...next];
    // Same call for both halves, for the reason `setPatchGroup` documents: what
    // is visible and what will ship must not come apart.
    sourceStore.setVisiblePatchIds(patchGroupIds);
    patchStore.notifyGroupsChanged();
  }
  /** One whole-project validation at a time. See `validateEverything`. */
  let fullValidationRunning = false;
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
  let patchSetsInFlight: Promise<PatchSetsBuild> | null = null;
  /**
   * The grouping, shared by `System.getPatchSets` and the publish gate.
   *
   * Hoisted out of the object literal because the publish gate needs it too and
   * `this` inside a returned literal is not something to build a safety check
   * on. One in-flight build either way.
   */
  /**
   * Which patch sets `toPublish` would leave a hole in.
   *
   * Empty means safe: within every patch set, what is about to ship is a prefix
   * of what the chain holds.
   *
   * A patch that has ALREADY shipped counts as shipped — it cannot be left
   * behind by this commit, and a chain still carrying it (an `appliedAt` that
   * arrived before the new commit did) would otherwise read as a hole in front
   * of everything staged and refuse every publish.
   */
  async function prefixViolations(
    toPublish: readonly PatchId[],
  ): Promise<PrefixViolation[]> {
    const chain = patchStore.allRecords();
    let index;
    try {
      index = indexPatchSets(
        await computePatchSets(),
        chain.map((record) => record.patchId),
      );
    } catch {
      /*
       * The grouping and the chain disagree, which is a skew rather than a
       * malformed group — the two are read at slightly different moments and a
       * patch can land in between.
       *
       * Failed OPEN, deliberately, and it is the one judgement call in this
       * gate. Refusing here would make a publish impossible whenever the worker
       * hiccups, with a message about patch sets that says nothing a user can
       * act on. The case this gate exists for — a group that really does skip a
       * patch — is not transient and is caught on the next click.
       */
      return [];
    }
    const shipped = new Set<PatchId>(toPublish);
    for (const record of chain) {
      if (record.appliedAt !== null && record.appliedAt !== undefined) {
        shipped.add(record.patchId);
      }
    }
    for (const patchId of patchStore.publishedPatchIds()) {
      shipped.add(patchId);
    }
    return validateGroup(index, shipped);
  }

  /**
   * The closure a write must carry: which OTHER patches have to join this
   * author's group so it stays prefix-closed.
   *
   * Computed here rather than in the caller, and against a grouping that is
   * AWAITED rather than one already rendered. That is the whole point:
   * `PatchSync.listenTo` flushes synchronously on `patch:create`, so a resolver
   * reading the last-rendered patch sets sees an index that does not contain
   * the patch being saved — it is in no set, `stageClosure` has nothing to pull
   * in for it, and `withPatchIds` comes out empty in the NORMAL case, not a
   * corner one. That is precisely the hole `DESIGN.md` says a write cannot
   * open, and with automatic repair removed it now surfaces only as a publish
   * refusal naming raw patch ids.
   *
   * Returns only what is NEW. The server set-unions, so re-sending what the
   * group already holds is a no-op — and on a long chain it is a much larger
   * request, once per keystroke batch.
   */
  async function computeWriteClosure(
    patchIds: readonly PatchId[],
  ): Promise<PatchId[]> {
    if (patchGroupIds === null) {
      // Unscoped: no group to keep closed.
      return [];
    }
    /*
     * Did the BUILD plan against a chain containing these patches?
     *
     * Asked of the build, not of the index. Two earlier versions asked
     * something else and were both wrong, in opposite directions:
     *
     * - `index.setsOf.has(id)` — false forever for a patch of only `file` or
     *   `test` ops, which `PatchSets.insertOp` skips, so every gallery delete
     *   paid for a second build that could not change its answer;
     * - `index.chainPosition.has(id)` — true always, because the index was
     *   being built from `allRecords()` at THIS moment while the sets came
     *   from a shared in-flight promise planned before this patch existed. The
     *   retry below became dead code and every write made during a build sent
     *   an empty closure. That is the normal case while typing, since
     *   `usePatchSets` re-runs on each chain movement and the save flushes
     *   synchronously on `patch:create`.
     *
     * The build now carries its own chain, so the question is answerable. The
     * index is built from that same chain too, or its positions would describe
     * a chain the sets do not.
     */
    const covers = (build: PatchSetsBuild) => {
      const planned = new Set(build.chain);
      return patchIds.every((patchId) => planned.has(patchId));
    };
    let index: PatchSetIndex;
    try {
      let build = await computePatchSetsBuild();
      if (!covers(build)) {
        /*
         * A build that was already in flight when this write happened, so it
         * planned against a chain without these ids. `computePatchSetsBuild`
         * shares the in-flight promise, which is right for readers and wrong
         * here. The first has settled by now, so this starts a fresh one.
         */
        build = await computePatchSetsBuild();
      }
      index = indexPatchSets(build.sets, build.chain);
    } catch {
      // The grouping and the chain disagree, which is possible mid-sync. Join
      // the group without a closure rather than refusing the write: losing the
      // edit is worse, and the prefix can still be restored by staging.
      return [];
    }
    const held = new Set(patchGroupIds);
    const next = stageClosure(index, held, patchIds);
    return [...next].filter(
      (patchId) => !held.has(patchId) && !patchIds.includes(patchId),
    );
  }

  /**
   * A grouping, together with the chain it was PLANNED against.
   *
   * The chain is part of the answer, not context: `computePatchSets` shares an
   * in-flight build, so a caller can be handed a grouping planned before the
   * patch it is asking about existed. Without the chain there is no way to tell
   * — see `computeWriteClosure`, where asking the wrong question made the
   * staleness check dead code and every write during a build under-closed.
   */
  type PatchSetsBuild = {
    sets: SerializedPatchSet;
    /** Chain order at plan time, which is also what `sets` describes. */
    chain: PatchId[];
  };

  function computePatchSetsBuild(): Promise<PatchSetsBuild> {
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
      const patchIds = chain.map((record) => record.patchId);
      const plan = patchSetChain.plan(patchIds);
      const request = patchSetRequest(plan, chain);
      const sets = await patchSetStore.getPatchSets(request);
      // AFTER the call, not before: a worker that threw or a message that was
      // never answered must not leave the host believing the grouping moved.
      patchSetChain.covers(plan);
      return { sets, chain: patchIds };
    })().finally(() => {
      patchSetsInFlight = null;
    });
    patchSetsInFlight = run;
    return run;
  }

  function computePatchSets(): Promise<SerializedPatchSet> {
    return computePatchSetsBuild().then((build) => build.sets);
  }
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
    const res = await options.discardPatches(
      toDelete,
      await computeDiscardClosure(toDelete),
    );
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
  const deferPendingValidation: DeferPendingValidation =
    options.deferPendingValidation ??
    ((run) => {
      const timer = setTimeout(run, PENDING_VALIDATION_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    });
  /**
   * Non-null exactly while a pass is armed, which is what makes the arming
   * idempotent: the second patch of a burst finds it set and adds nothing.
   */
  let cancelPendingValidation: (() => void) | null = null;
  function scheduleValidationOfPendingModules(): void {
    if (cancelPendingValidation !== null) return;
    cancelPendingValidation = deferPendingValidation(() => {
      cancelPendingValidation = null;
      const modules = new Set<ModuleFilePath>();
      for (const record of patchStore.allRecords()) {
        modules.add(record.moduleFilePath);
      }
      for (const moduleFilePath of modules) {
        // Fire and forget: the result reaches readers as `validation:result`,
        // and a failure to validate is the validation store's to report.
        void validationStore.validate(moduleFilePath);
      }
    });
  }

  const unsubscribe = [
    patchStore.listenTo(stat, sourceStore),
    /*
     * A patch this client just wrote joins the scope — BEFORE the source store
     * is told about it.
     *
     * Order is the whole point of registering it here rather than with the
     * other listeners further down. `SourceStore.listenTo` is next in this
     * list, and a `StoreBus` calls its listeners in registration order, so
     * running first means the patch is already visible by the time
     * `applyEntries` decides whether to hold it. Registered after, the patch
     * would be applied as held and then un-held by a full module rebuild —
     * correct, but a rebuild of the module's whole chain on every keystroke.
     */
    patchStore.events.on("patch:create", (event) => {
      extendPatchGroup(event.patches);
    }),
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
    previewStore.listenTo(),
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
    /**
     * A patch that has left the chain cannot be anybody's parent.
     *
     * `PatchSync` computes the parent of the next write from what the SERVER has
     * said exists, and nothing about a discard reached it: the ids were deleted
     * through the discard seam and dropped from the store, and the sync went on
     * naming one of them. See `PatchSync.forget` for what that cost — a discard
     * followed by an edit lost the edit, and every edit after it, until the tab
     * was reloaded.
     *
     * On `patch:drop` rather than in `discard()` so that the other ways a patch
     * leaves are covered by the same line: another tab's discard arrives as
     * `reconcileVanished` dropping what stat has stopped naming, and a patch the
     * server refuses is dropped by `PatchSync` itself.
     */
    patchStore.events.on("patch:drop", (event) => {
      patchSync.forget(event.patches);
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
    previewStore,
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
    getPatchSets() {
      return computePatchSets();
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
    /**
     * Validate every module that has been loaded, and say while it runs.
     *
     * For the quiet moment after auto-save has caught up. The per-save gate only
     * checks the modules the batch touched, which is what keeps typing cheap —
     * but it means a module nobody has edited this session is never checked, and
     * a cross-module break (a `keyOf` pointing at a key another file just lost)
     * belongs to neither module's patches.
     *
     * Sequential on purpose: the validation worker is a single FIFO queue, so
     * firing all of them at once would put a whole project ahead of the next
     * keystroke's module in that queue. One at a time leaves gaps for it.
     */
    async validateEverything() {
      if (fullValidationRunning) {
        return;
      }
      fullValidationRunning = true;
      validationStore.events.emit({
        type: "validation:full-pass",
        running: true,
      });
      try {
        for (const moduleFilePath of sourceStore.loadedModules()) {
          await validationStore.validate(moduleFilePath);
        }
      } finally {
        fullValidationRunning = false;
        validationStore.events.emit({
          type: "validation:full-pass",
          running: false,
        });
      }
    },
    computeWriteClosure(patchIds) {
      return computeWriteClosure(patchIds);
    },
    computeDiscardClosure(patchIds) {
      return computeDiscardClosure(patchIds);
    },
    setOwnPatchGroupId(patchGroupId) {
      ownPatchGroupId = patchGroupId;
    },
    setPatchGroupResolver(resolver) {
      if (resolver === undefined) {
        patchSync.setPatchGroupResolver(undefined);
        return;
      }
      /*
       * Wrapped, so the CLOSURE lands in the local scope as well as on the
       * server.
       *
       * The resolver's answer is "these other patches must join my group for it
       * to stay applicable" — another author's array insert that this edit sits
       * on top of, typically. The server unions them in, so after this write
       * they are in the group; if the scope did not follow, the editor would be
       * rendering its own edit WITHOUT the insert it was written against, and a
       * publish would ship a combination that was never on screen.
       *
       * Here rather than in `PatchSync` because the scope lives here, and here
       * rather than in the caller because every caller would have to remember.
       */
      patchSync.setPatchGroupResolver(async (patchIds) => {
        const membership = await resolver(patchIds);
        if (membership !== undefined) {
          extendPatchGroup([...patchIds, ...membership.withPatchIds]);
          /*
           * And SAY SO, when the closure brought somebody else's work along.
           *
           * This is the one place other people's patches enter a user's view
           * without them asking, and until now it happened in silence — the
           * scope widened, the modules rebuilt, and the only trace was a number
           * changing on the Review button.
           *
           * Announced only when the closure moved something. `patchIds` is the
           * user's own write and is not news; an empty `withPatchIds`, which
           * is the common case, says nothing at all.
           */
          const widenedBy = membership.withPatchIds.filter(
            (patchId) => !patchIds.includes(patchId),
          );
          if (widenedBy.length > 0) {
            patchSync.events.emit({
              type: "patch:group-widened",
              patches: widenedBy,
            });
          }
        }
        return membership;
      });
    },
    async stagePatches(request) {
      if (options.stagePatches === undefined) {
        return {
          status: "error",
          message: "This system cannot change patch group membership.",
        };
      }
      return options.stagePatches(request);
    },
    async unstagePatches(request) {
      if (options.unstagePatches === undefined) {
        return {
          status: "error",
          message: "This system cannot change patch group membership.",
        };
      }
      return options.unstagePatches(request);
    },
    persistPatchGroupChange(patchGroupId, change) {
      if (change.patchIds.length === 0 && change.withPatchIds.length === 0) {
        return;
      }
      if (patchGroupId === undefined) {
        /*
         * Nothing to stage into yet. Held rather than dropped — see the
         * declaration; the alternative was a control that moved the screen and
         * silently persisted nothing.
         *
         * Capped so a user clicking away at a review screen on a branch whose
         * group never materialises cannot grow this without bound. The oldest
         * moves are the ones a later toggle is most likely to have already
         * undone, so they are the ones dropped.
         */
        deferredGroupChanges.push(change);
        if (deferredGroupChanges.length > MAX_DEFERRED_GROUP_CHANGES) {
          deferredGroupChanges = deferredGroupChanges.slice(
            -MAX_DEFERRED_GROUP_CHANGES,
          );
        }
        return;
      }
      void sendPatchGroupChange(patchGroupId, change);
    },
    flushPatchGroupChanges(patchGroupId) {
      if (deferredGroupChanges.length === 0) return;
      const queued = deferredGroupChanges;
      // Cleared BEFORE sending, so a change made while the flush is in flight
      // queues behind nothing and is sent on its own rather than being replayed
      // twice by the next flush.
      deferredGroupChanges = [];
      /*
       * Replayed against the CURRENT scope, not verbatim.
       *
       * Verbatim was wrong in the very case the queue exists for. The group id
       * appears because the user went and wrote something, and that write runs
       * its own closure: a queued unstage of a patch the closure then pulled
       * back in would be replayed afterwards and take it out of the group on
       * the server — while the local scope, and therefore publish, still held
       * it. The result was a hole in front of the user's own patch, surfacing a
       * publish refusal naming raw ids, and only after a reload.
       *
       * The local scope is what this client intends the group to be, and every
       * click has already been folded into it. So the queue is only a means of
       * persisting that intent, and where the two disagree the scope wins —
       * which is the write winning over the earlier click, as it must.
       *
       * Snapshotted once, so a scope change during the flush cannot make two
       * entries in one replay disagree with each other.
       */
      const scope = patchGroupIds === null ? null : new Set(patchGroupIds);
      void (async () => {
        for (const change of queued) {
          const inScope = (patchId: PatchId) =>
            scope === null ||
            (change.type === "stage"
              ? scope.has(patchId)
              : !scope.has(patchId));
          // Both halves are filtered the same way. Filtering only the union and
          // then intersecting would let the request name an id it is no longer
          // sending.
          const patchIds = change.patchIds.filter(inScope);
          const withPatchIds = change.withPatchIds.filter(inScope);
          if (patchIds.length === 0 && withPatchIds.length === 0) continue;
          await sendPatchGroupChange(patchGroupId, {
            ...change,
            patchIds,
            withPatchIds,
          });
        }
      })();
    },
    seedPatchGroup(ids) {
      /*
       * Adopt the server's answer as a STARTING POINT, without losing what this
       * tab has written since that answer was read.
       *
       * The annotation is fetched when the chain gains ids this client does not
       * have, and a patch this client wrote is never one of those — so at the
       * moment the shell first has a group to scope to, the annotation
       * routinely predates the last few things the user typed. Seeding it
       * verbatim held those patches: the editor showed the value from before
       * the keystroke, having just accepted the keystroke.
       *
       * Union with every INTERNAL patch in the chain, because a patch this tab
       * wrote is in this author's group on the server by construction — the
       * content API puts it there. Only the seed does this. An explicit stage
       * or unstage is the user's decision and is honoured exactly, which is why
       * it goes through `setPatchGroup` instead; unstaging your own change has
       * to be able to hide it.
       */
      const next = new Set(ids);
      for (const record of patchStore.allRecords()) {
        if (patchStore.originOf(record.patchId) === "internal") {
          next.add(record.patchId);
        }
      }
      patchGroupIds = [...next];
      sourceStore.setVisiblePatchIds(patchGroupIds);
      patchStore.notifyGroupsChanged();
    },
    setPatchGroup(ids) {
      patchGroupIds = ids === null ? null : [...ids];
      // Source is scoped in the same call, so "what I can see" and "what I will
      // publish" cannot come apart.
      sourceStore.setVisiblePatchIds(patchGroupIds);
      // And anything counting the scope is woken, which `setVisiblePatchIds`
      // alone does not do: it bumps only the modules whose visible set moved,
      // so a scope change that shows nothing new tells no one.
      patchStore.notifyGroupsChanged();
    },
    patchGroup() {
      return patchGroupIds;
    },
    async publish(requestedPatchIds, message, publishOptions) {
      const exact = publishOptions?.exact === true;
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
          // Never in `exact` mode. Waiting for the queue to drain is the right
          // thing when a person clicked Save and expects their last word in it;
          // it is the wrong thing on a timer, where the queue may never be empty
          // because they are still typing. There, an unsaved patch is simply not
          // in this batch and goes in the next one.
          !exact &&
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
          options.savePatches === undefined || exact
            ? []
            : patchStore.unsavedRecords();
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
        const chainNow = patchStore
          .allRecords()
          .map((record) => record.patchId);
        /*
         * In `exact` mode: the longest PREFIX of the chain the caller named.
         *
         * A prefix, not a subset, and that distinction is the whole safety
         * property — committing a patch while keeping an earlier one pending
         * would write a file that no sequence of the remaining patches can
         * explain. A prefix has no such problem: what is left is still a chain,
         * on top of a base that moved.
         *
         * Stopping at the first unsaved patch for the same reason. Nothing here
         * refuses because the chain grew: growing is what it does while someone
         * is typing, and a save that refuses whenever that happens is a save
         * that never runs.
         */
        /**
         * The chain, restricted to the caller's patch group.
         *
         * This is where independent publish actually happens, and it is a
         * deliberate weakening of the rule the comment above states. "Publish
         * the whole pending chain" is the conservative approximation of the
         * real constraint, which is that what ships must not leave behind a
         * patch whose paths it could move. Two patches that can move each
         * other's paths are, by definition, in the same PATCH SET — and a group
         * is required to hold a prefix of every patch set it touches
         * (`utils/patchGroups.ts`). So a group is safe to publish even though it
         * is not a prefix of the chain: what stays behind is in other patch
         * sets, and committing this cannot shift it.
         *
         * Chain ORDER is preserved by filtering `chainNow` rather than using
         * the group's own ordering, because the server applies what it is given
         * in the order it is given, and the group is a set.
         *
         * Unscoped (`null`) is unchanged: the whole chain, exactly as before.
         */
        const groupScoped =
          patchGroupIds === null
            ? chainNow
            : ((ids) => chainNow.filter((patchId) => ids.has(patchId)))(
                new Set(patchGroupIds),
              );
        const toPublish = exact
          ? takeNamedPrefix(
              groupScoped,
              new Set(requestedPatchIds),
              new Set(
                patchStore.unsavedRecords().map((record) => record.patchId),
              ),
            )
          : groupScoped;
        if (toPublish.length === 0) {
          return { status: "nothing-to-publish" };
        }

        /*
         * The prefix invariant, checked where it actually costs something.
         *
         * A scoped publish is only safe because a group holds a PREFIX of every
         * patch set it touches: what stays behind is in other patch sets and
         * cannot have its paths shifted by this commit. Skip a patch and ship a
         * later one from the same set and the later one applies onto a value
         * that has never existed — silently, and in a commit.
         *
         * `stageClosure` cannot produce such a group; that is what it is for.
         * But a group can arrive this way regardless — a stale annotation, a
         * client on an older closure version, a repair that has not run, a
         * hand-written request to `/patch-groups` — so the invariant is checked
         * here rather than assumed, at the one point where getting it wrong is
         * not recoverable.
         *
         * Refused rather than repaired, and this is the ONLY thing that
         * notices. Nothing auto-repairs a coalesced hole: widening the group
         * would publish work the user never staged, and truncating it would
         * drop their own. So the refusal names what is missing, and the review
         * screen is where they choose — stage it, or unstage what depends on
         * it.
         */
        if (patchGroupIds !== null) {
          const violations = await prefixViolations(toPublish);
          if (violations.length > 0) {
            const missing = violations.flatMap(
              (violation) => violation.missing,
            );
            return {
              status: "failed",
              message:
                "These changes depend on earlier changes that are not staged: " +
                missing.join(", ") +
                ". Stage them, or unstage the changes that depend on them.",
              retryable: false,
            };
          }
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
        if (!exact && patchStore.chainVersion() !== chainAt) {
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

        const headCommitSha = stat.currentHeadCommitSha();
        /*
         * Decided once, and read twice: it is what the server is asked to do
         * and what the store is told happened. Recomputing it after the publish
         * would ask a chain the publish has already moved.
         */
        const closesOwnPatchGroup = emptiesOwnPatchGroup(toPublish);
        const outcome = await options.publishPatches({
          patchIds: toPublish,
          message,
          ...(closesOwnPatchGroup
            ? { closesPatchGroupId: ownPatchGroupId }
            : {}),
          /*
           * The world this publish was decided against.
           *
           * Read here rather than captured at the top of the call: the gate
           * above has just re-checked the chain, so this is the head that goes
           * with the set about to ship.
           */
          ...(headCommitSha !== null
            ? { expectedHeadCommitSha: headCommitSha }
            : {}),
        });
        if (outcome.status === "head-moved") {
          // Nothing was written. The review screen showed a world somebody else
          // has changed since, so the honest answer is to look again.
          return { status: "refused", reason: "head-moved" };
        }
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

        /*
         * The head this publish just made.
         *
         * Set before anything else, and this is the fix for a client refusing
         * its OWN next publish: `stat.currentHeadCommitSha()` above is what
         * goes out as `expectedHeadCommitSha`, and until a `/stat` response
         * lands it was still the pre-publish head. The server then compared it
         * against the commit this client had just made and answered 409
         * "someone else published while you were reviewing" — for the user's
         * own commit, on every pause in typing with auto-publish on.
         */
        if (outcome.commitSha !== undefined) {
          stat.setHeadCommitSha(outcome.commitSha);
        }

        /*
         * Changes the save threw away to be able to write anything at all.
         *
         * Dropped locally FIRST, before anything else moves: they are gone from
         * the server, and a chain still holding them would offer them to the
         * next save, fail the same way, and never get past it. `drop` rather
         * than `forgetPublished` — their effect is NOT in the base and has to
         * come off the screen, which is the whole difference between the two.
         */
        const removed = outcome.removed ?? [];
        if (removed.length > 0) {
          patchStore.drop(removed.map((entry) => entry.patchId));
          status.reportError(
            removed.length === 1
              ? "An edit could not be applied and was removed."
              : `${removed.length} edits could not be applied and were removed.`,
            removed
              .map((entry) => `${entry.moduleFilePath}: ${entry.message}`)
              .join("\n"),
          );
          console.error(
            "Val: the save removed these changes because they could not be applied.",
            removed,
          );
        }

        // Recorded before the mode split, because it is true in both: these
        // patches are in a commit now. `filePatchIds` needs it in `http` mode,
        // where the chain keeps them — see `PatchStore.publishedIds`.
        patchStore.markPublished(toPublish, {
          // Whether the group was CLOSED, not whether a publish happened: a
          // partial publish leaves it open on the server holding the rest of
          // its work, and the store has to go on knowing which group that is.
          closedOwnPatchGroup: closesOwnPatchGroup,
        });
        if (mode === "fs") {
          // ORDER MATTERS, and this is the whole reason both methods exist.
          // Promote first: the patched value becomes the base, so when the chain
          // goes the displayed value does not move. Reversed, every published
          // field would flash back to its pre-publish text until the next source
          // fetch landed.
          // Bakes the published prefix into the base and keeps whatever was
          // typed while the request was in flight. Was `promoteToBase` plus
          // `forgetPublished`, which together baked the tail into the base AND
          // left it in the chain to be applied again on top of itself.
          sourceStore.promotePublished(toPublish, [...affected]);
          patchStore.forgetPublished(toPublish);
        }
        // In `http` mode the patches stay server-side and are re-applied, so the
        // chain stays too — removing it would show the value without them until
        // the next fetch, and promoting the base would then double-apply.
        // The ids that were actually published, which is what the caller has to
        // forget — it asked with a list taken before the flush.
        return {
          status: "published",
          patchIds: toPublish,
          ...(removed.length > 0 ? { removed } : {}),
        };
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
      /*
       * Computed here, not in the seam.
       *
       * The seam is the network call; this needs the patch sets, which only
       * this graph has. And it has to be computed BEFORE the delete: afterwards
       * the discarded patches are gone from the chain, so the sets they were in
       * no longer say what was built on top of them.
       */
      const res = await options.discardPatches(
        patchIds,
        await computeDiscardClosure(patchIds),
      );
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
      if (cancelPendingValidation !== null) {
        cancelPendingValidation();
        cancelPendingValidation = null;
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
