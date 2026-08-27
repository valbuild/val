import {
  Internal,
  type ModuleFilePath,
  type PatchId,
  type SelectorSource,
  type SourcePath,
  type ValModule,
} from "@valbuild/core";
import type { Json } from "@valbuild/core";
import type { ParentRef, Patch } from "@valbuild/core/patch";
import { createSystem, type System } from "./createSystem";
import { SearchStore } from "./SearchStore";
import { PatchSetStore } from "./PatchSetStore";
import { ReferenceStore } from "./ReferenceStore";
import { RecordingActivity } from "./activity";
import type { CreatePatchResult } from "./PatchStore";
import type { SaveResult } from "./PatchSync";
import type { SourcePeek } from "./SourceStore";
import type {
  FieldEvent,
  Head,
  PatchRecord,
  Revision,
  SourceRead,
  SystemEvent,
} from "./types";

/**
 * A deep-partial of `T` with branded strings widened back to `string`.
 *
 * Val's `SourcePath`, `ModuleFilePath` and `PatchId` are branded (`string &
 * { VAL_DATA_TYPE }`), which is right for the stores but makes a plain test
 * literal like `sources: ["/test.val.ts"]` an error. The alternative to this
 * type is an `as ModuleFilePath` on every literal in every assertion — casts
 * that assert nothing and hide the one case where a real mistake would be
 * caught.
 *
 * Distributes over unions, so a matcher for `SystemEvent` is a matcher for
 * whichever member its `type` names.
 */
export type Loose<T> = T extends string
  ? string
  : T extends number | boolean | null | undefined
    ? T
    : T extends readonly (infer U)[]
      ? readonly Loose<U>[]
      : T extends object
        ? { [K in keyof T]?: Loose<T[K]> }
        : T;

/**
 * Subset match, as a predicate.
 *
 * The waiting assertions below need to ask "does this event match?" and carry
 * on if it does not — an assertion that throws cannot answer that. So jest's
 * own `toMatchObject` is used as the oracle and its throw is turned into
 * `false`, rather than reimplementing recursive subset matching here and having
 * two subtly different notions of "matches" in the same test.
 */
function matches(actual: unknown, expected: unknown): boolean {
  try {
    expect(actual).toMatchObject(expected as Record<string, unknown>);
    return true;
  } catch {
    return false;
  }
}

/** For failure messages: short, and stable enough to diff by eye. */
function describeValue(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/**
 * A position in a log. Every waiting assertion returns one so the next
 * assertion can be bounded to "after this point", which is how the test asks
 * about a WINDOW rather than about all of history.
 */
export type Cursor = number;

export type WaitOptions = {
  /** Only consider entries at or after this cursor. */
  since?: Cursor;
  timeoutMs?: number;
};

/**
 * How long a waiting assertion waits before declaring absence.
 *
 * 50ms, down from an arbitrary 500. The number is measured, not guessed: an
 * instrumented run of this suite showed the longest a waiter ACTUALLY waits is
 * 1-6ms — the `ledger.has` calls that span the async patch fetch. So this is
 * roughly 8x the observed peak.
 *
 * Two things make a low value right here. A passing test never reaches this
 * timeout at all — `didReceive` and `ledger.has` resolve the moment their event
 * arrives, and the timer only governs giving up — so lowering it costs nothing on
 * the happy path and makes a genuine failure report 10x sooner, which is most of
 * what this rig is for. And a value 80x the requirement hides exactly the
 * slowness it should surface.
 *
 * Not lower than this: 5ms is BELOW the measured 6ms peak. It passed several
 * runs, which is what a marginal timeout looks like right before it becomes a
 * flake someone else has to chase.
 */
const DEFAULT_TIMEOUT_MS = 50;

/**
 * Lets the whole event pipeline run to quiescence.
 *
 * Two macrotask turns, not one: the chain is
 * `stat:receive` → (await fetch) → `patch:receive` → apply, and each `await`
 * inside it needs a turn to resume. A single `Promise.resolve()` tick would
 * return before the fetch resolved, which would make every `noMessages()`
 * assertion pass vacuously — the most dangerous kind of green test.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Records every event from every store's bus, in the order they were emitted.
 *
 * Matching is "anywhere at or after `since`", so an assertion does not care
 * what else happened in between. Ordering is asserted only where the test
 * asks for it, by threading a cursor.
 */
export class Ledger {
  private log: { seq: number; event: SystemEvent }[] = [];
  private waiters: {
    expected: Loose<SystemEvent>;
    since: Cursor;
    resolve: (cursor: Cursor) => void;
  }[] = [];

  /**
   * `nextSeq` is shared with the activity log, so the two can be merged into one
   * causally ordered view. `activity` is optional only so a Ledger can be
   * constructed alone in a unit test.
   */
  constructor(
    private readonly nextSeq: () => number = () => 0,
    private readonly activity?: RecordingActivity,
  ) {}

  /** Events only, so cursors and matching keep their original meaning. */
  get entries(): SystemEvent[] {
    return this.log.map((entry) => entry.event);
  }

  record(event: SystemEvent): void {
    this.log.push({ seq: this.nextSeq(), event });
    const cursor = this.log.length;
    const remaining: typeof this.waiters = [];
    for (const waiter of this.waiters) {
      if (cursor - 1 >= waiter.since && matches(event, waiter.expected)) {
        waiter.resolve(cursor);
      } else {
        remaining.push(waiter);
      }
    }
    this.waiters = remaining;
  }

  position(): Cursor {
    return this.log.length;
  }

  /**
   * Events and work, merged on the shared clock.
   *
   * This is the view worth reading when an assertion fails, and the reason the
   * two channels share a clock at all: a count that is one too high tells you
   * the number is wrong, while `patch:create → source:clone-module ×2 →
   * source:apply-patch → source:patch-apply` tells you which hop did it twice.
   */
  timeline(): string {
    const merged: { seq: number; line: string }[] = [
      ...this.log.map((entry) => ({
        seq: entry.seq,
        line: `EVENT ${describeValue(entry.event)}`,
      })),
      ...(this.activity?.records ?? []).map((record) => ({
        seq: record.seq,
        line: `  work ${record.kind}${
          record.subject === undefined ? "" : ` ${record.subject}`
        }${record.count === undefined ? "" : ` (count=${record.count})`}`,
      })),
    ].sort((a, b) => a.seq - b.seq);
    return merged.map((entry) => `  ${entry.seq}: ${entry.line}`).join("\n");
  }

  /**
   * Resolve once an event loosely matching `expected` has been recorded at or
   * after `since`; reject with the whole ledger if it never is.
   *
   * The dump on failure is the point: a system wired out of events fails by
   * *not* emitting, and "timed out" without the log tells you nothing about
   * which hop dropped it.
   */
  async has(
    expected: Loose<SystemEvent>,
    options?: WaitOptions,
  ): Promise<Cursor> {
    const since = options?.since ?? 0;
    for (let index = since; index < this.log.length; index++) {
      if (matches(this.log[index].event, expected)) {
        return index + 1;
      }
    }
    return new Promise<Cursor>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(
          new Error(
            `Ledger never recorded ${describeValue(
              expected,
            )} at or after ${since}.\nTimeline:\n${this.timeline()}`,
          ),
        );
      }, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const waiter = {
        expected,
        since,
        resolve: (cursor: Cursor) => {
          clearTimeout(timer);
          resolve(cursor);
        },
      };
      this.waiters.push(waiter);
    });
  }
}

/** One registered field listener, plus the assertions a test makes about it. */
export type FieldListener = {
  readonly path: SourcePath;
  /** The field instance this listener registered as. */
  readonly fieldId: string;
  readonly received: readonly FieldEvent[];
  /** Wait for a matching event; resolves to a cursor past it. */
  didReceive(
    expected: Loose<FieldEvent>,
    options?: WaitOptions,
  ): Promise<Cursor>;
  /**
   * Assert nothing arrived at or after `since`, and return the current cursor.
   *
   * Always awaited, and it waits before asserting: the claim is "the pipeline
   * ran and still did not wake me", which is only meaningful once the pipeline
   * has run. Asserting immediately would pass for a system that had not started
   * yet.
   */
  noMessages(options?: { since?: Cursor }): Promise<Cursor>;
  unsubscribe(): void;
};

export type Listeners = {
  /**
   * Register a listener at `path`, as one field INSTANCE.
   *
   * `fieldId` defaults to a fresh id, so two `set()` calls on one path are two
   * instances — which is the studio-field-plus-inline-overlay case, and the
   * default a test almost always wants. Pass one explicitly to say "this is the
   * field that made that edit".
   *
   * Takes a plain string, not a `SourcePath`: branding a literal in a test buys
   * nothing and costs a cast at every call site.
   */
  set(path: string, fieldId?: string): FieldListener;
};

export type TestSourceStore = {
  get(path: string, revision: Revision | null): Promise<SourceRead>;
  /** The cheap probe: is this revision still current? */
  isCurrent(revision: Revision): Promise<boolean>;
  /**
   * Convenience forward to `host.receive` — the real entry point.
   *
   * Kept because it reads well at the top of a test, but it is a forward, not a
   * shortcut: modules go in through the HOST store, which keeps the `Schema`
   * instances and pushes only the serialized halves down. Nothing bypasses that.
   */
  testReceive(modules: ValModule<SelectorSource>[]): Promise<void>;
  /**
   * Deliver one `.jsonValues()` entry's content directly, bypassing the fetch.
   *
   * For the case where the ARRIVAL is the subject rather than the fetching of
   * it: what a load does to the revision, to the search index, to validity.
   * A test about the fetch itself just reads a path inside the entry.
   */
  receiveJsonEntry(moduleFilePath: string, key: string, content: Json): void;
  /** Status at a path with no side effects — notably, no entry fetch. */
  peek(path: string): SourcePeek;
  /**
   * The in-realm read: patched source for one module, uncloned.
   *
   * Exposed for tests that have to build the payload the way `createSystem`
   * builds it — a test about what crosses the worker seam cannot use `get()`,
   * because `get` is the FIELD-facing read and the seam carries whole modules.
   */
  moduleSource(moduleFilePath: string): Json | undefined;
  loadedModules(): ModuleFilePath[];
};

export type TestStatStore = {
  /**
   * Announce patches as if another session had created them: the records are
   * put where the (fake) server can serve them, and stat is told only their
   * ids — exactly what `/stat` returns. The patch store then has to fetch the
   * ops, which is what makes `external-partial` a state this test can reach.
   */
  simulateExternal(records: PatchRecord[]): void;
  /**
   * A stat snapshot naming exactly `patchIds`, with the server left ALONE.
   *
   * Models the poll whose response predates something this client did: `/stat`
   * describes the server as it was when the request was ISSUED, so a snapshot can
   * legitimately omit a patch that exists. Deleting nothing server-side is the
   * point — a test using this asserts that the client does not read a stale
   * snapshot as a deletion.
   */
  simulateStaleStat(patchIds: PatchId[]): void;
};

export type TestPatchStore = {
  getHead(): Promise<Head>;
  /** Does this patch exist only here? The optimistic-state axis. */
  isPending(patchId: string): boolean;
  /** Everything still local-only, in chain order. */
  pendingPatchIds(): PatchId[];
  /**
   * File path -> the unpublished patch carrying its bytes.
   *
   * Exposed because this is what a component turns into an image URL, and the
   * difference between "saved" and "published" is invisible from anywhere else.
   */
  filePatchIds(): ReadonlyMap<string, PatchId>;
  /** Mark patches as shipped, without going through a real publish. */
  markPublished(patchIds: readonly PatchId[]): void;
  /**
   * Remove patches from the chain, as a permanent server refusal does.
   *
   * Exposed because a drop is the one chain change that is not an append, and
   * several invariants are about what has to be rebuilt when it happens. Reaching
   * it through a rejected `PUT` would work but would make those tests about the
   * write path rather than about the chain.
   */
  drop(patchIds: readonly PatchId[]): void;
  /**
   * Create a patch belonging to an editing session.
   *
   * Separate from {@link TestPatchStore.createPatch} rather than a sixth
   * positional argument: the session is the subject of only a few tests, and
   * threading `undefined` through four parameters to reach it at every other call
   * site is how a rig becomes unreadable.
   */
  createPatchInSession(
    moduleFilePath: string,
    patch: Patch,
    sessionId: string,
  ): Promise<PatchRecord>;
  /**
   * Create a patch and assume it worked.
   *
   * Throws if it did not, which is a TEST convenience and not a shortcut in the
   * store: creating a patch can genuinely fail (an upload can fail), and a test
   * that is not about that should not have to narrow the union at every call.
   * Use {@link TestPatchStore.tryCreatePatch} when the failure IS the subject.
   */
  createPatch(
    moduleFilePath: string,
    patch: Patch,
    meta?: Record<string, Json>,
    fieldId?: string,
  ): Promise<PatchRecord>;
  /** Create a patch and hand back the whole result, failures included. */
  tryCreatePatch(
    moduleFilePath: string,
    patch: Patch,
    meta?: Record<string, Json>,
    fieldId?: string,
  ): Promise<CreatePatchResult>;
};

/**
 * The fake file server: what bytes exist, and a way to make the next upload of
 * a given path fail.
 *
 * Keyed by patch id AND path, mirroring the real thing — draft files are per
 * patch, which is why a draft image URL carries a patch id at all.
 */
export type TestFiles = {
  /** The stored bytes, or `undefined` if there is no such file. */
  get(patchId: string, filePath: string): string | undefined;
  /** Every `${patchId}\0${filePath}` key currently stored. */
  keys(): string[];
  /** Make uploads AND deletes of this path fail until cleared. */
  failFor(filePath: string, message?: string): void;
  /** Make deletes of this path fail, so a rollback leaves an orphan. */
  failDeletesFor(filePath: string): void;
  clearFailures(): void;
};

/**
 * The fake `GET /json` server: which entry fetches were asked for, and a way to
 * make one fail.
 *
 * The CONTENT is not configured here. It is resolved from the module definition
 * the test already wrote — `c.json(() => ...)` carries a runtime import thunk,
 * and the fake awaits it. So an entry's content is declared once, in the schema,
 * the way an author declares it; a rig that took the content separately would let
 * a test assert against content the module does not actually have.
 */
export type TestJsonEntries = {
  /** Every `${moduleFilePath}\0${key}` fetched, in order, duplicates included. */
  requests(): string[];
  /** Make fetches of this entry fail until cleared. */
  failFor(moduleFilePath: string, key: string, message?: string): void;
  clearFailures(): void;
};

/**
 * The fake `PUT /patches`.
 *
 * It genuinely enforces the head: a write whose `parentRef` is not the server's
 * current tip is answered 409, computed from the server's own chain rather than
 * from a flag a test sets. That distinction is the point — a stubbed conflict
 * proves the client handles a 409 it was handed, and this proves the client can
 * PRODUCE the situation and recover from it. {@link simulateConcurrentWrite} is
 * how another session moves the head without telling this client, which is the
 * only way a real 409 ever happens.
 */
export type TestServer = {
  /** The server's chain, in order. What `/stat` would return. */
  patchIds(): PatchId[];
  /**
   * Every `PUT` the client made, in order, with the parent and session it named.
   *
   * `sessionId` is here because the server records it per patch while the request
   * carries one for the whole batch — so which patches shared a request is the
   * thing worth asserting.
   */
  writes(): {
    patchIds: PatchId[];
    parentRef: ParentRef;
    sessionId: string | null;
  }[];
  /**
   * Make the next write wait on `gate` before answering.
   *
   * The only way to observe batching: the store sends what is unsaved the moment
   * it is asked, so a test has to hold a request open to have anything arrive
   * while one is in flight.
   */
  holdNextWrite(gate: Promise<void>): void;
  /**
   * Another session writes. The head moves and this client is NOT told, so its
   * next write names a stale parent and is answered 409.
   */
  simulateConcurrentWrite(records: PatchRecord[]): void;
  /**
   * Answer the next N writes with this instead of processing them.
   *
   * For the outcomes the fake server cannot produce on its own: a network
   * failure, a 400 on a patch it has no opinion about, a 401.
   */
  failNextWrites(result: SaveResult, times?: number): void;
  clearFailures(): void;
  /** Every id the client asked the discard seam to delete, in order. */
  discarded(): PatchId[];
  /** Make the next discard answer with an error. */
  failNextDiscard(message: string): void;
  /**
   * Another session deletes patches this client holds.
   *
   * The client learns only what it really would: the next stat stops naming
   * them. Working out that they are gone — rather than that stat was stale — is
   * what `PatchStore.reconcileVanished` is for.
   */
  simulateForeignDiscard(patchIds: PatchId[]): void;
  /**
   * `/stat` names a patch the fetch will not hand over.
   *
   * A server contradicting itself, which really happened: the fs store counted
   * the directories on disk to announce, and walked the parent links between
   * them to deliver, so one lost record made it announce 410 changes and send
   * 359. Deliberately NOT the same as {@link simulateForeignDiscard} - a deleted
   * patch stops being announced, and absence then means "gone"; here it stays
   * announced, and absence means the server is wrong.
   */
  simulateAnnouncedNotDelivered(patchIds: PatchId[]): void;
  /**
   * Another session PUBLISHES patches this client holds.
   *
   * Indistinguishable from a discard by the patch list alone — `/save` in `fs`
   * mode deletes the patches it committed — except that a publish makes a commit
   * and so MOVES `baseSha`. That is the only signal telling the client whether a
   * vanished patch's effect belongs in source or not.
   */
  simulateForeignPublish(patchIds: PatchId[]): void;
  /** What the chain is rooted at. */
  baseSha: string;
};

export type TestSystem = {
  sourceStore: TestSourceStore;
  patchStore: TestPatchStore;
  stat: TestStatStore;
  /**
   * The host store, holding the real `Schema` instances. Handed through so a
   * test can drive intake the way the app does, and can assert that renders and
   * custom validation actually reached an instance.
   */
  host: System["host"];
  /**
   * The user-facing error channel, handed through so a test can assert that the
   * person editing was actually TOLD - which for a whole class of failures is
   * the only thing that distinguishes handled from silently swallowed.
   */
  status: System["status"];
  /**
   * Handed through unwrapped: unlike source/patch/stat, nothing about these
   * needs a test-only method. Their whole API is already on-demand (`get`,
   * `validate`, `getPatchSets`, `search`), which is what a test wants to drive.
   */
  renderStore: System["renderStore"];
  patchSetStore: System["patchSetStore"];
  validationStore: System["validationStore"];
  searchStore: System["searchStore"];
  /**
   * Gathers the snapshot and pushes it across the worker seam. On the system
   * rather than on the search store because the search store — being in the
   * worker realm — cannot reach the source it would need to gather.
   */
  buildSearchIndex: System["buildSearchIndex"];
  /**
   * Gathers the chain and builds the grouping on demand.
   *
   * On the system rather than the store for the same reason `buildSearchIndex`
   * is: the patch-set store is in the worker realm and cannot reach the chain.
   */
  getPatchSets: System["getPatchSets"];
  /** Search, indexing first if a build is owed. The query is what pays. */
  search: System["search"];
  /**
   * Handed through so a test can gather the snapshot the worker realm is given.
   * Read-only in practice: intake goes through `host.receive`.
   */
  schemaStore: System["schemaStore"];
  /** Who points at this thing, scanning first if a pass is owed. */
  findReferences: System["findReferences"];
  /** What the field at one path points at. */
  referenceAt: (path: string) => ReturnType<System["referenceAt"]>;
  referenceStore: System["referenceStore"];
  files: TestFiles;
  jsonEntries: TestJsonEntries;
  /** The write path: what reached the server, and how to make it fail. */
  server: TestServer;
  /** The write-back loop, so a test can await a save and read its state. */
  patchSync: System["patchSync"];
  ledger: Ledger;
  /**
   * What each store DID, as opposed to what it announced.
   *
   * The channel exists to answer one question: was anything done more times than
   * it had to be? So the assertion it is built for is a count over a window —
   * `activity.count("host:execute-render", { since })`.
   */
  activity: RecordingActivity;
  listeners: Listeners;
  dispose(): void;
};

export function initTestSystem(): TestSystem {
  // One clock for both channels, so the merged timeline is causally ordered.
  let seq = 0;
  const nextSeq = () => ++seq;
  const activity = new RecordingActivity(nextSeq);
  const ledger = new Ledger(nextSeq, activity);
  /** Stands in for the server's patch table. */
  const serverPatches = new Map<PatchId, PatchRecord>();
  const announced: PatchId[] = [];
  let nextPatchId = 0;

  /**
   * Stands in for the server's write endpoint.
   *
   * `serverChain` is what the server would return from `/stat`, and it is the
   * SAME list `announced` holds — kept as one list on purpose, because a fake
   * server with two ideas of its own chain would let a test pass against a
   * server that could not exist.
   */
  const baseSha = "test-base-sha";
  /** Moves when a publish commits — see `simulateForeignPublish`. */
  let publishedBaseSha = baseSha;
  const writes: {
    patchIds: PatchId[];
    parentRef: ParentRef;
    sessionId: string | null;
  }[] = [];
  const queuedWriteFailures: SaveResult[] = [];
  /** Every id the client asked the discard seam to delete, in order. */
  const discarded: PatchId[] = [];
  /** Make the next discard fail, so the local-drop-anyway path is reachable. */
  let discardFailure: string | null = null;
  /**
   * A gate the next write waits on.
   *
   * So a test can hold a request open and create more patches while it is in
   * flight — which is the only way to observe BATCHING, since the store sends
   * whatever is unsaved the moment it is asked.
   */
  let heldWrite: Promise<void> | null = null;

  /** Stands in for the server's file store. */
  const serverFiles = new Map<string, string>();
  const uploadFailures = new Map<string, string>();
  const deleteFailures = new Set<string>();
  const fileKey = (patchId: string, filePath: string) =>
    `${patchId}\0${filePath}`;

  /**
   * Stands in for the server's `.val.json` files.
   *
   * The modules handed to `testReceive` are kept because they are the only place
   * the entry content exists: `HostStore.receive` JSON round-trips source, which
   * strips the `c.json` thunk on the way in — deliberately, since a real client
   * receives markers over the wire and has no thunk to call.
   */
  const receivedModules = new Map<ModuleFilePath, ValModule<SelectorSource>>();
  const jsonEntryRequests: string[] = [];
  const jsonEntryFailures = new Map<string, string>();
  const entryKey = (moduleFilePath: string, key: string) =>
    `${moduleFilePath}\0${key}`;

  // The worker-realm stores are constructed HERE and handed in through
  // `workerRealm`, rather than left to `createSystem`'s default. Two reasons,
  // both real: the rig needs concrete references to attach the ledger to their
  // event buses (a bridge has no `events` — that is the per-realm loss the seam
  // documents), and passing them exercises the option a real worker would use.
  const workerSearch = new SearchStore(activity);
  const workerPatchSets = new PatchSetStore(activity);
  const workerReferences = new ReferenceStore(activity);

  const system = createSystem({
    workerRealm: {
      search: workerSearch,
      patchSets: workerPatchSets,
      references: workerReferences,
    },
    uploadFile: async ({ patchId, filePath, data }) => {
      // Genuinely async, so no store can come to depend on an upload resolving
      // synchronously — against a real POST it never will.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const failure = uploadFailures.get(filePath);
      if (failure !== undefined) {
        return { status: "error", message: failure };
      }
      if (data === null) {
        if (deleteFailures.has(filePath)) {
          return { status: "error", message: `Could not delete ${filePath}` };
        }
        serverFiles.delete(fileKey(patchId, filePath));
        return { status: "ok" };
      }
      serverFiles.set(fileKey(patchId, filePath), data);
      return { status: "ok" };
    },
    discardPatches: async (patchIds) => {
      // Genuinely async, like every seam in this rig.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (discardFailure !== null) {
        const message = discardFailure;
        discardFailure = null;
        return { status: "error", message };
      }
      const deleted: PatchId[] = [];
      for (const patchId of patchIds) {
        discarded.push(patchId);
        if (!serverPatches.delete(patchId)) continue;
        const at = announced.indexOf(patchId);
        if (at !== -1) announced.splice(at, 1);
        deleted.push(patchId);
      }
      // The ids the SERVER deleted, which is what the real endpoint answers and
      // what `createSystem.discard` is careful to use instead of what it asked.
      return { status: "discarded", patchIds: deleted };
    },
    fetchPatches: async (patchIds) => {
      // Genuinely async, even though the data is in memory: the store must not
      // be allowed to accidentally depend on the fetch resolving synchronously,
      // because against a real `GET /patches` it never will.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const patches: PatchRecord[] = [];
      for (const patchId of patchIds) {
        const record = serverPatches.get(patchId);
        if (record) {
          patches.push(record);
        }
        // An id the table does not hold is OMITTED, not reported as an error,
        // because that is what the real server does: `ValOpsFS.fetchPatches`
        // reads its table and filters it by the requested ids, so one it does
        // not have is simply absent from the result, and `ValOpsHttp` passes the
        // ids to the content API the same way.
        //
        // This used to answer `No such patch`, and the difference is not
        // cosmetic: `PatchStore.reconcileVanished` treats an error as "could not
        // tell" and keeps the patch, so against the old rig a deleted patch
        // could never be observed being dropped — a test would have passed
        // against a server that cannot exist, which is the one thing this rig is
        // built not to allow.
      }
      return { patches };
    },
    savePatches: async ({ patches, parentRef, sessionId }) => {
      // Genuinely async, like every seam in this rig.
      await new Promise((resolve) => setTimeout(resolve, 0));
      writes.push({
        patchIds: patches.map((entry) => entry.patchId),
        parentRef,
        sessionId: sessionId ?? null,
      });
      const held = heldWrite;
      if (held !== null) {
        heldWrite = null;
        await held;
      }
      const queued = queuedWriteFailures.shift();
      if (queued !== undefined) {
        return queued;
      }
      // The head check, done for real. `expected` is computed from the server's
      // own chain, so a conflict happens because the parent IS stale, not
      // because a test said so.
      const tip = announced[announced.length - 1];
      const expected: ParentRef =
        tip === undefined
          ? { type: "head", headBaseSha: baseSha }
          : { type: "patch", patchId: tip };
      const matches =
        expected.type === parentRef.type &&
        (expected.type === "head"
          ? parentRef.type === "head" &&
            expected.headBaseSha === parentRef.headBaseSha
          : parentRef.type === "patch" &&
            expected.patchId === parentRef.patchId);
      if (!matches) {
        return {
          status: "conflict",
          message: `Expected parent ${JSON.stringify(
            expected,
          )} but got ${JSON.stringify(parentRef)}`,
        };
      }
      const newPatchIds: PatchId[] = [];
      for (const entry of patches) {
        // Stored so a later `/stat` + `/patches` round trip can serve them back,
        // which is what a resync after a conflict actually does.
        serverPatches.set(entry.patchId, {
          patchId: entry.patchId,
          moduleFilePath: entry.path,
          patch: entry.patch,
          createdAt: new Date().toISOString(),
        });
        announced.push(entry.patchId);
        newPatchIds.push(entry.patchId);
      }
      const last = newPatchIds[newPatchIds.length - 1];
      return {
        status: "saved",
        newPatchIds,
        parentRef:
          last === undefined
            ? { type: "head", headBaseSha: baseSha }
            : { type: "patch", patchId: last },
      };
    },
    /**
     * What a real client does after a 409: ask what the server has now, which
     * feeds both the patch store (fetch the ops it is missing) and the sync (a
     * new parent to name).
     */
    resyncChain: async () => {
      system.stat.receiveStat({ patches: [...announced], baseSha });
      // One tick, so the fetch the stat kicks off has a chance to land before
      // the retry names a parent — otherwise the retry can be correct and the
      // chain still be missing the other session's ops.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    createPatchId: () => `local-${++nextPatchId}` as PatchId,
    // No real waiting. The backoff schedule is arithmetic and needs no test;
    // what needs testing is that a retry HAPPENS, and a rig that waited the real
    // 500 ms would make every retry test slow enough that nobody runs it.
    saveBackoffMs: () => 0,
    fetchJsonEntry: async (moduleFilePath, key) => {
      // Genuinely async, like every other seam in this rig: against a real
      // `GET /json` it never resolves synchronously, so nothing may come to
      // depend on it doing so.
      await new Promise((resolve) => setTimeout(resolve, 0));
      jsonEntryRequests.push(entryKey(moduleFilePath, key));
      const failure = jsonEntryFailures.get(entryKey(moduleFilePath, key));
      if (failure !== undefined) {
        return { status: "error", message: failure };
      }
      const module = receivedModules.get(moduleFilePath);
      if (module === undefined) {
        return {
          status: "error",
          message: `No such module: ${moduleFilePath}`,
        };
      }
      const source = Internal.getSource(module);
      if (source === null || typeof source !== "object") {
        return {
          status: "error",
          message: `${moduleFilePath} is not a record`,
        };
      }
      const entry = (source as Record<string, unknown>)[key];
      if (!Internal.isJson(entry)) {
        return {
          status: "error",
          message: `'${key}' of ${moduleFilePath} is not a json entry`,
        };
      }
      const thunk = Internal.getJsonImport(entry);
      if (thunk === undefined) {
        return {
          status: "error",
          message: `'${key}' of ${moduleFilePath} carries no import thunk`,
        };
      }
      return { status: "ok", content: (await thunk()).default as Json };
    },
    activity,
  });

  const offBuses = [
    system.stat.events.onAny((event) => ledger.record(event)),
    system.schemaStore.events.onAny((event) => ledger.record(event)),
    system.patchStore.events.onAny((event) => ledger.record(event)),
    system.sourceStore.events.onAny((event) => ledger.record(event)),
    workerPatchSets.events.onAny((event) => ledger.record(event)),
    system.validationStore.events.onAny((event) => ledger.record(event)),
    workerSearch.events.onAny((event) => ledger.record(event)),
    workerReferences.events.onAny((event) => ledger.record(event)),
    system.host.events.onAny((event) => ledger.record(event)),
    system.renderStore.events.onAny((event) => ledger.record(event)),
    // The write path emits on its own bus, and the conflict/rejected events are
    // the only record that a save went wrong at all — a test that could not see
    // them could only assert the recovery, never that recovery was needed.
    system.patchSync.events.onAny((event) => ledger.record(event)),
  ];

  const registered: FieldListener[] = [];

  let nextFieldId = 0;
  const listeners: Listeners = {
    set(path, fieldId) {
      const instanceId = fieldId ?? `field-${++nextFieldId}`;
      const received: FieldEvent[] = [];
      const waiters: {
        expected: Loose<FieldEvent>;
        since: Cursor;
        resolve: (cursor: Cursor) => void;
      }[] = [];
      let waiting = waiters;
      const sourcePath = path as SourcePath;
      const off = system.sourceStore.addListener(
        sourcePath,
        instanceId,
        (event) => {
          received.push(event);
          const cursor = received.length;
          waiting = waiting.filter((waiter) => {
            if (cursor - 1 >= waiter.since && matches(event, waiter.expected)) {
              waiter.resolve(cursor);
              return false;
            }
            return true;
          });
        },
      );
      const listener: FieldListener = {
        path: sourcePath,
        fieldId: instanceId,
        received,
        async didReceive(expected, options) {
          const since = options?.since ?? 0;
          for (let index = since; index < received.length; index++) {
            if (matches(received[index], expected)) {
              return index + 1;
            }
          }
          return new Promise<Cursor>((resolve, reject) => {
            const timer = setTimeout(() => {
              waiting = waiting.filter((w) => w !== waiter);
              reject(
                new Error(
                  `Listener at ${path} never received ${describeValue(
                    expected,
                  )} at or after ${since}. Received: ${describeValue(received)}`,
                ),
              );
            }, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
            const waiter = {
              expected,
              since,
              resolve: (cursor: Cursor) => {
                clearTimeout(timer);
                resolve(cursor);
              },
            };
            waiting.push(waiter);
          });
        },
        async noMessages(options) {
          await settle();
          const since = options?.since ?? 0;
          const unexpected = received.slice(since);
          if (unexpected.length > 0) {
            throw new Error(
              `Listener at ${path} should not have been woken, but received ${describeValue(
                unexpected,
              )}`,
            );
          }
          return received.length;
        },
        unsubscribe: off,
      };
      registered.push(listener);
      return listener;
    },
  };

  const files: TestFiles = {
    get: (patchId, filePath) => serverFiles.get(fileKey(patchId, filePath)),
    keys: () => [...serverFiles.keys()],
    failFor: (filePath, message) => {
      uploadFailures.set(filePath, message ?? `Upload of ${filePath} failed`);
    },
    failDeletesFor: (filePath) => {
      deleteFailures.add(filePath);
    },
    clearFailures: () => {
      uploadFailures.clear();
      deleteFailures.clear();
    },
  };

  const jsonEntries: TestJsonEntries = {
    requests: () => [...jsonEntryRequests],
    failFor: (moduleFilePath, key, message) => {
      jsonEntryFailures.set(
        entryKey(moduleFilePath, key),
        message ?? `Could not fetch '${key}' of ${moduleFilePath}`,
      );
    },
    clearFailures: () => {
      jsonEntryFailures.clear();
    },
  };

  return {
    files,
    jsonEntries,
    ledger,
    activity,
    listeners,
    host: system.host,
    status: system.status,
    renderStore: system.renderStore,
    patchSetStore: system.patchSetStore,
    validationStore: system.validationStore,
    searchStore: system.searchStore,
    buildSearchIndex: () => system.buildSearchIndex(),
    getPatchSets: () => system.getPatchSets(),
    search: (query, limit, offset) => system.search(query, limit, offset),
    findReferences: (query) => system.findReferences(query),
    referenceAt: (path) => system.referenceAt(path as SourcePath),
    referenceStore: system.referenceStore,
    schemaStore: system.schemaStore,
    sourceStore: {
      get: (path, revision) =>
        system.sourceStore.get(path as SourcePath, revision),
      isCurrent: (revision) => system.sourceStore.isCurrent(revision),
      async testReceive(modules) {
        for (const module of modules) {
          const path = Internal.getValPath(module);
          if (path === undefined) {
            throw new Error("Module has no path");
          }
          receivedModules.set(path as string as ModuleFilePath, module);
        }
        system.host.receive(modules);
        await settle();
      },
      receiveJsonEntry: (moduleFilePath, key, content) =>
        system.sourceStore.receiveJsonEntry(
          moduleFilePath as ModuleFilePath,
          key,
          content,
        ),
      peek: (path) => system.sourceStore.peek(path as SourcePath),
      moduleSource: (moduleFilePath) =>
        system.sourceStore.moduleSource(moduleFilePath as ModuleFilePath),
      loadedModules: () => system.sourceStore.loadedModules(),
    },
    patchStore: {
      getHead: () => system.patchStore.getHead(),
      isPending: (patchId) => system.patchStore.isPending(patchId as PatchId),
      pendingPatchIds: () => system.patchStore.pendingPatchIds(),
      filePatchIds: () => system.patchStore.filePatchIds(),
      markPublished: (patchIds) => system.patchStore.markPublished(patchIds),
      drop: (patchIds) => system.patchStore.drop(patchIds),
      async createPatchInSession(moduleFilePath, patch, sessionId) {
        const res = await system.patchStore.createPatch(
          moduleFilePath as ModuleFilePath,
          patch,
          undefined,
          undefined,
          undefined,
          undefined,
          sessionId,
        );
        if (res.status !== "created") {
          throw new Error(`createPatchInSession failed: ${res.message}`);
        }
        serverPatches.set(res.record.patchId, res.record);
        await settle();
        return res.record;
      },
      async tryCreatePatch(moduleFilePath, patch, meta, fieldId) {
        const res = await system.patchStore.createPatch(
          moduleFilePath as ModuleFilePath,
          patch,
          meta,
          fieldId,
        );
        if (res.status === "created") {
          // The fake patch TABLE gets it, so a later `/stat` announcing this id
          // can serve its ops rather than failing the fetch.
          //
          // Deliberately NOT pushed onto `announced`. It used to be, back when
          // nothing wrote patches back: "a local patch is also on the server as
          // far as every later read is concerned" was true when no write path
          // existed. It is now actively wrong — it puts the patch on the server
          // BEFORE the client writes it, so the client's first real write names a
          // parent the server has already moved past and is answered 409, and
          // then the retry stores the patch a second time. The save is what puts
          // a patch on the server now.
          serverPatches.set(res.record.patchId, res.record);
        }
        await settle();
        return res;
      },
      async createPatch(moduleFilePath, patch, meta, fieldId) {
        const res = await this.tryCreatePatch(
          moduleFilePath,
          patch,
          meta,
          fieldId,
        );
        if (res.status !== "created") {
          throw new Error(
            `createPatch failed: ${res.message}. Use tryCreatePatch if the failure is the point.`,
          );
        }
        return res.record;
      },
    },
    stat: {
      simulateExternal(records) {
        for (const record of records) {
          serverPatches.set(record.patchId, record);
          announced.push(record.patchId);
        }
        // `baseSha` included so the write path has a parent to name. Without it
        // a test that edits after a stat would report "cannot save yet", which
        // is correct behaviour and a confusing thing to hit by accident.
        system.stat.receiveStat({ patches: [...announced], baseSha });
      },
      simulateStaleStat(patchIds) {
        // The server is left exactly as it is: this is a snapshot that is merely
        // OUT OF DATE, not a report that anything was deleted.
        system.stat.receiveStat({ patches: [...patchIds], baseSha });
      },
    },
    patchSync: system.patchSync,
    server: {
      baseSha,
      patchIds: () => [...announced],
      writes: () => writes.map((write) => ({ ...write })),
      discarded: () => [...discarded],
      failNextDiscard(message) {
        discardFailure = message;
      },
      simulateForeignPublish(patchIds) {
        for (const patchId of patchIds) {
          serverPatches.delete(patchId);
          const at = announced.indexOf(patchId);
          if (at !== -1) announced.splice(at, 1);
        }
        publishedBaseSha += "-committed";
        system.stat.receiveStat({
          patches: [...announced],
          baseSha: publishedBaseSha,
        });
      },
      simulateAnnouncedNotDelivered(patchIds) {
        // Into the announcement, never into the table the fetch reads.
        for (const patchId of patchIds) {
          announced.push(patchId);
        }
        system.stat.receiveStat({ patches: [...announced], baseSha });
      },
      simulateForeignDiscard(patchIds) {
        // Another session, the CLI, or another tab deletes patches this client
        // holds. The client is told the way it really would be — by the next
        // stat no longer naming them — and nothing else. It has to work out that
        // they are gone, which is the whole point.
        for (const patchId of patchIds) {
          serverPatches.delete(patchId);
          const at = announced.indexOf(patchId);
          if (at !== -1) announced.splice(at, 1);
        }
        system.stat.receiveStat({ patches: [...announced], baseSha });
      },
      simulateConcurrentWrite(records) {
        // Deliberately NOT followed by `receiveStat`: the whole point is that
        // this client does not know, so its next write names a stale parent. A
        // version of this that also told the client could never produce a 409.
        for (const record of records) {
          serverPatches.set(record.patchId, record);
          announced.push(record.patchId);
        }
      },
      holdNextWrite(gate) {
        heldWrite = gate;
      },
      failNextWrites(result, times = 1) {
        for (let index = 0; index < times; index++) {
          queuedWriteFailures.push(result);
        }
      },
      clearFailures() {
        queuedWriteFailures.length = 0;
      },
    },
    dispose() {
      for (const listener of registered) listener.unsubscribe();
      for (const off of offBuses) off();
      system.dispose();
    },
  };
}

/** Build an external patch record the way another session's edit would look. */
export function externalPatch(
  patchId: string,
  moduleFilePath: string,
  patch: Patch,
): PatchRecord {
  return {
    patchId: patchId as PatchId,
    moduleFilePath: moduleFilePath as ModuleFilePath,
    patch,
  };
}

export function patchIds(records: readonly PatchRecord[]): PatchId[] {
  return records.map((record) => record.patchId);
}

/**
 * Brand a module file path literal.
 *
 * Same reasoning as {@link Loose}: the stores are right to carry branded types,
 * but a test literal should not have to. Kept here, next to that rationale, so
 * the assertion is one documented cast in the rig rather than an undocumented
 * one at every call site in every test.
 */
export function mfp(moduleFilePath: string): ModuleFilePath {
  return moduleFilePath as ModuleFilePath;
}

/** Brand a source path literal. Same reasoning as {@link mfp}. */
export function sp(path: string): SourcePath {
  return path as SourcePath;
}
