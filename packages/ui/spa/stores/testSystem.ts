import type {
  ModuleFilePath,
  PatchId,
  SelectorSource,
  SourcePath,
  ValModule,
} from "@valbuild/core";
import type { Json } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { createSystem, type System } from "./createSystem";
import { RecordingActivity } from "./activity";
import type { CreatePatchResult } from "./PatchStore";
import type {
  FieldEvent,
  Head,
  PatchRecord,
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

const DEFAULT_TIMEOUT_MS = 500;

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
   * Register a listener at `path`.
   *
   * Takes a plain string, not a `SourcePath`: branding a literal in a test buys
   * nothing and costs a cast at every call site.
   */
  set(path: string): FieldListener;
};

export type TestSourceStore = {
  get(path: string, head: Head): Promise<SourceRead>;
  /**
   * Convenience forward to `host.receive` — the real entry point.
   *
   * Kept because it reads well at the top of a test, but it is a forward, not a
   * shortcut: modules go in through the HOST store, which keeps the `Schema`
   * instances and pushes only the serialized halves down. Nothing bypasses that.
   */
  testReceive(modules: ValModule<SelectorSource>[]): Promise<void>;
};

export type TestStatStore = {
  /**
   * Announce patches as if another session had created them: the records are
   * put where the (fake) server can serve them, and stat is told only their
   * ids — exactly what `/stat` returns. The patch store then has to fetch the
   * ops, which is what makes `external-partial` a state this test can reach.
   */
  simulateExternal(records: PatchRecord[]): void;
};

export type TestPatchStore = {
  getHead(): Promise<Head>;
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
  ): Promise<PatchRecord>;
  /** Create a patch and hand back the whole result, failures included. */
  tryCreatePatch(
    moduleFilePath: string,
    patch: Patch,
    meta?: Record<string, Json>,
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
  files: TestFiles;
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

  /** Stands in for the server's file store. */
  const serverFiles = new Map<string, string>();
  const uploadFailures = new Map<string, string>();
  const deleteFailures = new Set<string>();
  const fileKey = (patchId: string, filePath: string) =>
    `${patchId}\0${filePath}`;

  const system = createSystem({
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
    fetchPatches: async (patchIds) => {
      // Genuinely async, even though the data is in memory: the store must not
      // be allowed to accidentally depend on the fetch resolving synchronously,
      // because against a real `GET /patches` it never will.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const patches: PatchRecord[] = [];
      const errors: Record<PatchId, string> = {};
      for (const patchId of patchIds) {
        const record = serverPatches.get(patchId);
        if (record) {
          patches.push(record);
        } else {
          errors[patchId] = `No such patch: ${patchId}`;
        }
      }
      return { patches, errors };
    },
    createPatchId: () => `local-${++nextPatchId}` as PatchId,
    activity,
  });

  const offBuses = [
    system.stat.events.onAny((event) => ledger.record(event)),
    system.schemaStore.events.onAny((event) => ledger.record(event)),
    system.patchStore.events.onAny((event) => ledger.record(event)),
    system.sourceStore.events.onAny((event) => ledger.record(event)),
    system.patchSetStore.events.onAny((event) => ledger.record(event)),
    system.validationStore.events.onAny((event) => ledger.record(event)),
    system.searchStore.events.onAny((event) => ledger.record(event)),
    system.host.events.onAny((event) => ledger.record(event)),
    system.renderStore.events.onAny((event) => ledger.record(event)),
  ];

  const registered: FieldListener[] = [];

  const listeners: Listeners = {
    set(path) {
      const received: FieldEvent[] = [];
      const waiters: {
        expected: Loose<FieldEvent>;
        since: Cursor;
        resolve: (cursor: Cursor) => void;
      }[] = [];
      let waiting = waiters;
      const sourcePath = path as SourcePath;
      const off = system.sourceStore.addListener(sourcePath, (event) => {
        received.push(event);
        const cursor = received.length;
        waiting = waiting.filter((waiter) => {
          if (cursor - 1 >= waiter.since && matches(event, waiter.expected)) {
            waiter.resolve(cursor);
            return false;
          }
          return true;
        });
      });
      const listener: FieldListener = {
        path: sourcePath,
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

  return {
    files,
    ledger,
    activity,
    listeners,
    host: system.host,
    renderStore: system.renderStore,
    patchSetStore: system.patchSetStore,
    validationStore: system.validationStore,
    searchStore: system.searchStore,
    buildSearchIndex: () => system.buildSearchIndex(),
    getPatchSets: () => system.getPatchSets(),
    search: (query, limit, offset) => system.search(query, limit, offset),
    sourceStore: {
      get: (path, head) => system.sourceStore.get(path as SourcePath, head),
      async testReceive(modules) {
        system.host.receive(modules);
        await settle();
      },
    },
    patchStore: {
      getHead: () => system.patchStore.getHead(),
      async tryCreatePatch(moduleFilePath, patch, meta) {
        const res = await system.patchStore.createPatch(
          moduleFilePath as ModuleFilePath,
          patch,
          meta,
        );
        if (res.status === "created") {
          // A locally created patch is also on the server as far as every later
          // read is concerned, so the fake table gets it too. Without this, a
          // later `/stat` announcing it would fetch and fail.
          serverPatches.set(res.record.patchId, res.record);
          announced.push(res.record.patchId);
        }
        await settle();
        return res;
      },
      async createPatch(moduleFilePath, patch, meta) {
        const res = await this.tryCreatePatch(moduleFilePath, patch, meta);
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
        system.stat.receiveStat({ patches: [...announced] });
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
