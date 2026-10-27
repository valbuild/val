import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";
import { noopActivity, type ActivitySink } from "./activity";

/**
 * One transient, dismissable message to the editor.
 *
 * `id` so a UI can dismiss one without dismissing the queue, and `timestamp` so
 * it can expire. `details` is the underlying server message, kept separate from
 * `message` because the first is for the editor and the second is for whoever
 * they forward it to.
 */
export type TransientError = {
  id: string;
  message: string;
  timestamp: number;
  details?: string;
};

/**
 * Whether the schema the client holds is still the one the server has.
 *
 * `out-of-date` is a GATE, not a warning: a patch written against a schema that
 * has been redeployed can be applied to source the server will reject, or worse
 * accepted against a shape that no longer means the same thing. So it stops
 * writes rather than annotating them.
 */
export type SchemaFreshness = "current" | "out-of-date";

export type StatusSnapshot = {
  errors: readonly TransientError[];
  /** When the network started failing, or `null`. See `reportNetworkError`. */
  networkErrorSince: number | null;
  schemaError: string | null;
  schema: SchemaFreshness;
};

/**
 * REALM: host.
 *
 * Everything the editor needs to be TOLD, as opposed to everything it can read.
 * The engine spread these across a dozen `get*Snapshot` methods with their own
 * caches and invalidations; they are one store here because they are one
 * question — "is anything wrong, and can I still work?" — and because a UI that
 * shows them shows them together.
 *
 * Deliberately NOT where validation errors live. Those are per module, computed,
 * and cached against a schema version; these are announcements with no source of
 * truth other than the thing that raised them. Putting them together would make
 * `ValidationStore` the place errors of every kind accumulate, which is how it
 * would stop being about validation.
 */
export class StatusStore {
  readonly events = new StoreBus<SystemEvent>();

  private transient: TransientError[] = [];
  /**
   * The last value {@link current} returned, so repeated reads are `===`.
   *
   * The same contract every `peek` in this system has, and for the same reason: a
   * `useSyncExternalStore` consumer compares snapshots by identity and re-renders
   * forever if a fresh object comes back each time.
   *
   * Cleared by {@link announce}, which every mutator goes through — so the clear
   * cannot be forgotten, and it happens BEFORE the event rather than in a listener
   * racing the consumers of that same event.
   */
  private snapshot: StatusSnapshot | null = null;
  private networkErrorSince: number | null = null;
  private schemaError: string | null = null;
  private freshness: SchemaFreshness = "current";
  private nextId = 0;

  constructor(private readonly activity: ActivitySink = noopActivity) {}

  /**
   * Tell the editor something went wrong, once.
   *
   * De-duplicated by message: a retry loop that fails ten times has one thing to
   * say, and ten copies of it in a toast stack is worse than one. The timestamp
   * is refreshed so the newest occurrence is what expires.
   */
  reportError(message: string, details?: string): void {
    const existing = this.transient.find(
      (candidate) => candidate.message === message,
    );
    if (existing !== undefined) {
      existing.timestamp = Date.now();
      existing.details = details ?? existing.details;
      this.announce();
      return;
    }
    this.transient = [
      ...this.transient,
      {
        id: `status-${++this.nextId}`,
        message,
        timestamp: Date.now(),
        details,
      },
    ];
    this.activity.work("status:report-error");
    this.announce();
  }

  /** The editor dismissed these. */
  dismissErrors(ids: readonly string[]): void {
    const dismissed = new Set(ids);
    const kept = this.transient.filter((error) => !dismissed.has(error.id));
    if (kept.length === this.transient.length) return;
    this.transient = kept;
    this.announce();
  }

  /**
   * The network is failing, since when.
   *
   * A timestamp rather than a boolean, because "offline for 2 seconds" and
   * "offline for 5 minutes" are different messages and only the first should be
   * silent. Set once and left: repeated failures must not keep resetting the
   * clock, or a slow-failing connection never looks like an outage.
   */
  reportNetworkError(): void {
    if (this.networkErrorSince !== null) return;
    this.networkErrorSince = Date.now();
    this.announce();
  }

  clearNetworkError(): void {
    if (this.networkErrorSince === null) return;
    this.networkErrorSince = null;
    this.announce();
  }

  /** The schema itself could not be read or parsed. */
  reportSchemaError(message: string | null): void {
    if (this.schemaError === message) return;
    this.schemaError = message;
    this.announce();
  }

  /**
   * The server's schema is not the one this client holds.
   *
   * One-way on purpose: a client whose schema went stale cannot decide for itself
   * that it is fresh again, because the only thing that would make it fresh is a
   * reload. Announcing recovery it cannot deliver would leave writes enabled
   * against a schema it still does not have.
   */
  reportSchemaOutOfDate(): void {
    if (this.freshness === "out-of-date") return;
    this.freshness = "out-of-date";
    this.activity.work("status:schema-out-of-date");
    this.announce();
  }

  /** Everything the editor should be told, as one value. */
  current(): StatusSnapshot {
    if (this.snapshot === null) {
      this.snapshot = {
        errors: this.transient,
        networkErrorSince: this.networkErrorSince,
        schemaError: this.schemaError,
        schema: this.freshness,
      };
    }
    return this.snapshot;
  }

  /**
   * Drop the cached snapshot, then say something changed.
   *
   * One method rather than two lines in five places, so the order cannot be got
   * wrong: dispatch is synchronous, so a consumer reading `current()` from inside
   * this event must not be able to get the value from before it.
   */
  private announce(): void {
    this.snapshot = null;
    this.events.emit({ type: "status:change" });
  }
}
