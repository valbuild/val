import { Internal, type Json, type ModuleFilePath } from "@valbuild/core";
import { deepEqual } from "@valbuild/core/patch";
import type { ModuleRead, ModuleVersion } from "@valbuild/shared/internal";

// How long waitForLoad waits for draft data before giving up and resolving
// anyway (logging an error) so the Suspense boundary never hangs forever.
const LOAD_TIMEOUT_MS = 10000;

/** A read the overlay holds: always an answer. */
export type HeldRead = Extract<ModuleRead, { status: "ready" }>;

/**
 * The page's store of what the Studio sent it: one read per module, as the
 * relay sent it (`startOverlayRelay`). What `overlaySource` answers from.
 *
 * Moved here from `@valbuild/next` and `@valbuild/tanstack`, which each had a
 * copy: the page's half of the relay is the same in both.
 */
export class ValExternalStore {
  private readonly listeners: Map<SubscriberId, (() => void)[]>;
  private readonly loadPromises: Map<SubscriberId, Promise<void>>;
  // Path-keyed reads, as the Studio sent them. The single source of truth:
  // load state, snapshots and revisions are all derived from this, so data
  // can be queried for any combination of paths even before a subscriber
  // registers.
  private readonly reads: Map<ModuleFilePath, HeldRead>;
  // Bumped per path whenever its read MOVES: what `revision` is made of.
  private readonly revisions: Map<ModuleFilePath, number>;
  // Reference-stable per-subscriberId snapshot cache for `get`.
  // Built lazily from `reads` in get() and invalidated in receive().
  private readonly snapshots: Map<
    SubscriberId,
    Record<ModuleFilePath, Json> | undefined
  >;
  // One-shot listeners used solely by waitForLoad. Kept separate from the
  // useSyncExternalStore listeners so waitForLoad never has to register (and
  // leak) a subscriberId.
  private readonly loadListeners: Set<() => void>;

  constructor() {
    this.listeners = new Map();
    this.loadPromises = new Map();
    this.reads = new Map();
    this.revisions = new Map();
    this.snapshots = new Map();
    this.loadListeners = new Set();
  }

  subscribe = (paths: readonly ModuleFilePath[]) => (listener: () => void) => {
    const subscriberId = createSubscriberId(paths);
    const existing = this.listeners.get(subscriberId);
    if (existing) {
      existing.push(listener);
    } else {
      this.listeners.set(subscriberId, [listener]);
    }

    return () => {
      const current = this.listeners.get(subscriberId);
      if (!current) return;
      const idx = current.indexOf(listener);
      if (idx >= 0) current.splice(idx, 1);
      if (current.length === 0) this.listeners.delete(subscriberId);
    };
  };

  /** {@link receive}, for a source with nothing more to say about it. */
  update(path: ModuleFilePath, source: Json): boolean {
    return this.receive(path, {
      status: "ready",
      source,
      from: "overlay",
      version: null,
    });
  }

  /**
   * Take a module's read from the editor, as it sent it.
   *
   * Returns whether this actually MOVED the value, which the caller needs and
   * cannot work out for itself: the same source arrives more than once by
   * design. The editor sends a catch-up snapshot of everything it holds every
   * time the page becomes a new document — a reload, or the one the dev server
   * does when a publish rewrites the `.val.ts` files — and most of that
   * snapshot is content this page already has.
   *
   * Without the answer, the provider armed its refresh loop on the arrival
   * rather than on the change, so every publish bought a whole-route request
   * whether or not the page was out of date. With auto-save on that is one
   * per pause in typing, which in development is a re-render (and sometimes a
   * recompile) of the page — and it is what leaves the canvas looking
   * permanently busy.
   */
  receive(path: ModuleFilePath, read: HeldRead): boolean {
    // A miss means this page has never been given this module.
    const before = this.reads.get(path);
    const changed =
      before === undefined || !deepEqual(before.source, read.source);
    this.reads.set(path, read);
    if (!changed) {
      // Nothing downstream to do: every subscriber's snapshot still answers
      // with the same value, so invalidating them would be a re-render that
      // shows exactly what is already on screen.
      return false;
    }
    this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1);
    // Invalidate cached snapshots that include this path so the next get()
    // rebuilds a fresh (new-reference) record, then notify their listeners.
    for (const subscriberId of Array.from(this.snapshots.keys())) {
      if (includesPath(subscriberId, path)) {
        this.snapshots.delete(subscriberId);
      }
    }
    for (const subscriberId of this.listeners.keys()) {
      if (includesPath(subscriberId, path)) {
        this.emitChange(subscriberId);
      }
    }
    for (const listener of Array.from(this.loadListeners)) {
      listener();
    }
    return true;
  }

  /** What the editor sent for `path`, or `undefined` for nothing yet. */
  read(path: ModuleFilePath): HeldRead | undefined {
    return this.reads.get(path);
  }

  /**
   * Changes exactly when what this store holds for any of `paths` moves: a
   * `useSyncExternalStore` snapshot that is `===` while nothing moved.
   */
  revision(paths: readonly ModuleFilePath[]): string {
    return paths.map((path) => this.revisions.get(path) ?? 0).join(",");
  }

  private emitChange(subscriberId: SubscriberId) {
    for (const listener of this.listeners.get(subscriberId) ?? []) {
      listener();
    }
  }

  getSnapshot = (paths: readonly ModuleFilePath[]) => () => {
    return this.get(paths);
  };

  getServerSnapshot = (paths: readonly ModuleFilePath[]) => () => {
    return this.get(paths);
  };

  get = (
    paths: readonly ModuleFilePath[],
  ): Record<ModuleFilePath, Json> | undefined => {
    const subscriberId = createSubscriberId(paths);
    if (this.snapshots.has(subscriberId)) {
      return this.snapshots.get(subscriberId);
    }
    // Build the snapshot from the path-keyed reads so data that arrived
    // before this subscriber registered is still returned. Cache it for a
    // reference-stable result.
    let record: Record<ModuleFilePath, Json> | undefined;
    for (const p of paths) {
      const loaded = this.reads.get(p);
      if (loaded !== undefined) {
        if (!record) {
          record = {};
        }
        record[p] = loaded.source;
      }
    }
    this.snapshots.set(subscriberId, record);
    return record;
  };

  hasAllLoaded = (paths: readonly ModuleFilePath[]): boolean => {
    for (const p of paths) {
      if (!this.reads.has(p)) {
        return false;
      }
    }
    return true;
  };

  /**
   * Returns a cached promise that resolves once `update()` has populated
   * every path in `paths`. The same promise instance is returned for the
   * same paths until it resolves — required so `React.use` / classic
   * Suspense doesn't re-suspend on every render.
   *
   * If the data never arrives (network failure, a path that is never
   * `update()`'d, a typo in a module path) the promise would otherwise hang
   * forever and keep the Suspense boundary in its fallback. To avoid a silent
   * hang it resolves anyway after `LOAD_TIMEOUT_MS`, logging an error so the
   * failure is diagnosable while the page still renders with partial data.
   */
  waitForLoad = (paths: readonly ModuleFilePath[]): Promise<void> => {
    if (this.hasAllLoaded(paths)) {
      return Promise.resolve();
    }
    const subscriberId = createSubscriberId(paths);
    const existing = this.loadPromises.get(subscriberId);
    if (existing) {
      return existing;
    }
    const promise = new Promise<void>((resolve) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.loadListeners.delete(listener);
        this.loadPromises.delete(subscriberId);
      };
      const listener = () => {
        if (this.hasAllLoaded(paths)) {
          cleanup();
          resolve();
        }
      };
      const timeout = setTimeout(() => {
        const missing = paths.filter((p) => !this.reads.has(p));
        Internal.log.error(
          `draft module(s) did not load within ${LOAD_TIMEOUT_MS}ms; rendering with partial data. Missing: ${missing.join(", ")}`,
        );
        cleanup();
        resolve();
      }, LOAD_TIMEOUT_MS);
      // Don't let the pending timer keep a Node process (e.g. the test runner
      // or SSR) alive; setTimeout returns a number in the browser, where there
      // is nothing to unref.
      if (typeof timeout !== "number") {
        timeout.unref();
      }
      this.loadListeners.add(listener);
    });
    this.loadPromises.set(subscriberId, promise);
    return promise;
  };
}

type SubscriberId = string & {
  readonly _tag: unique symbol;
};

const SEPARATOR = "&";

function createSubscriberId(paths: readonly ModuleFilePath[]): SubscriberId {
  return paths.slice().sort().join(SEPARATOR) as SubscriberId;
}

/** Whether `path` is one of the paths a subscriber id was made of. */
function includesPath(subscriberId: SubscriberId, path: ModuleFilePath) {
  return subscriberId.split(SEPARATOR).includes(path);
}

/** What one `val-event` from the overlay did to the page's store. */
export type ValEventOutcome =
  | { type: "synced" }
  /** `changed`: the store holds something new, which arms a refresh. */
  | { type: "updated"; changed: boolean }
  | { type: "invalid"; detail: unknown };

/**
 * Apply one overlay event (`detail` of a `val-event`) to the page's store.
 * `sources-synced` says the editor has sent everything it holds; a
 * `source-update` hands over one module's read, which the store keeps as it
 * is (`read`). A Studio from the release before sent the bare `source`
 * instead, and a page newer than the Studio it is open in -- a deploy rolling
 * out -- still takes that.
 *
 * Moved here from `@valbuild/tanstack`'s draft store; `@valbuild/next`'s
 * provider had the same rule written inline.
 */
export function applyValEvent(
  store: ValExternalStore,
  detail: unknown,
): ValEventOutcome {
  if (typeof detail !== "object" || detail === null || !("type" in detail)) {
    return { type: "invalid", detail };
  }
  if (detail.type === "sources-synced") {
    return { type: "synced" };
  }
  if (detail.type === "source-update") {
    const moduleFilePath =
      "moduleFilePath" in detail ? detail.moduleFilePath : undefined;
    if (typeof moduleFilePath !== "string") {
      return { type: "invalid", detail };
    }
    const read = "read" in detail ? heldRead(detail.read) : undefined;
    if (read !== undefined) {
      return {
        type: "updated",
        changed: store.receive(moduleFilePath as ModuleFilePath, read),
      };
    }
    const source = "source" in detail ? detail.source : undefined;
    if (isJson(source)) {
      return {
        type: "updated",
        changed: store.update(moduleFilePath as ModuleFilePath, source),
      };
    }
  }
  return { type: "invalid", detail };
}

/** A relayed read, checked: it crossed a window, as data. */
function heldRead(value: unknown): HeldRead | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    value.status !== "ready" ||
    !("source" in value) ||
    !isJson(value.source)
  ) {
    return undefined;
  }
  return {
    status: "ready",
    source: value.source,
    from: "overlay",
    version:
      "version" in value && isModuleVersion(value.version)
        ? value.version
        : null,
  };
}

function isModuleVersion(value: unknown): value is ModuleVersion {
  return (
    typeof value === "object" &&
    value !== null &&
    "schema" in value &&
    typeof value.schema === "string" &&
    "base" in value &&
    typeof value.base === "string" &&
    "chain" in value &&
    typeof value.chain === "string"
  );
}

function isJson(value: unknown): value is Json {
  return value !== undefined;
}
