/**
 * What each store DID, as opposed to what it announced.
 *
 * ## Why this is not a `SystemEvent`
 *
 * Events are coordination: a store emits one so another store, or a field, can
 * react. Work records are observation — nothing in the system may react to one,
 * and nothing does. Three consequences follow, and each is a reason to keep the
 * two channels apart:
 *
 * - Adding ~20 members to `SystemEvent` would grow every exhaustive switch over
 *   it, for entries no consumer will ever handle.
 * - A work record is emitted from inside the hot path — the clone, the apply,
 *   the listener scan. Putting it on a `StoreBus` would mean an `EventTarget`
 *   dispatch (twice, since {@link StoreBus} also dispatches the wildcard) per
 *   unit of work.
 * - Production must pay nothing. {@link noopActivity} is the default, so the
 *   cost of an uninstrumented run is one method call that returns.
 *
 * ## What it is for
 *
 * Counting. The premise of this whole rewrite is that a keystroke's cost should
 * be proportional to the edited field rather than to the project, and that is a
 * claim about HOW MANY times each expensive thing runs. This channel is what
 * turns that claim into an assertion: "one keystroke ⇒ one clone, one apply, one
 * listener woken, zero renders, zero validations" is a test, not a hope.
 *
 * It is deliberately in-process rather than `performance.mark`-based. A count is
 * exactly reproducible in a node test; a duration is not.
 */

/**
 * A unit of work a store performed.
 *
 * Named `<store>:<verb>` to match the event vocabulary, so one glossary covers
 * both channels. The kinds worth having are the ones that answer "did we do this
 * more times than we had to" — the expensive operations, plus the cache
 * hit/miss pairs that show whether the caching is working, plus the fan-out
 * points where one cause can produce N units of work.
 */
export type WorkKind =
  // --- source: the clone and apply costs the rewrite exists to remove -------
  /** A whole module was deep-cloned. The headline cost in the diagnosis. */
  | "source:clone-module"
  /** `applyPatch` ran over one module for one patch record. */
  | "source:apply-patch"
  /** The listener registry was walked once, to find who to wake. */
  | "source:scan-listeners"
  /** One registered listener was invoked. The fan-out measure. */
  | "source:wake-listener"
  /** A patch was skipped because its module is not loaded. */
  | "source:skip-unloaded"
  /** One `get()` walked the module to a path. */
  | "source:read-path"
  /** One `.jsonValues()` entry's content was delivered into the store. */
  | "source:receive-json-entry"
  /** One `.jsonValues()` entry fetch was started. The request count. */
  | "source:load-json-entry"
  /**
   * A reader joined an entry fetch already in flight. This one being high while
   * `source:load-json-entry` stays at one is the dedup working.
   */
  | "source:share-json-entry-load"
  /** Entry content was folded into a module's source for an in-realm walk. */
  | "source:substitute-json-entries"
  // --- patch chain ----------------------------------------------------------
  /** One `fetchPatches` round trip. `count` is how many ids it asked for. */
  | "patch:fetch"
  /** A patch was created locally. */
  | "patch:create"
  /** One file's bytes were POSTed to the server, before its patch existed. */
  | "patch:upload-file"
  /** One file was deleted, after the patch that removed its reference landed. */
  | "patch:delete-file"
  /** A best-effort cleanup of a file uploaded for a patch that then failed. */
  | "patch:rollback-file"
  // --- schema --------------------------------------------------------------
  | "schema:receive"
  // --- host: the only place user closures run ------------------------------
  | "host:serialize-schema"
  | "host:execute-render"
  | "host:execute-validate"
  // --- render: router, so hit/miss is the whole story ----------------------
  | "render:cache-hit"
  | "render:cache-miss"
  /** A concurrent caller joined an in-flight render instead of starting one. */
  | "render:share-in-flight"
  // --- validation: two seams, counted separately --------------------------
  | "validation:cache-hit"
  | "validation:cache-miss"
  | "validation:share-in-flight"
  /** The worker-seam call. Expensive and always needed. */
  | "validation:schema-validate"
  /** The serialized-schema walk that finds where custom validators live. */
  | "validation:collect-custom-targets"
  | "validation:merge"
  // --- worker realm --------------------------------------------------------
  /** One patch record's ops were inserted into the patch sets. */
  | "patch-set:insert"
  | "patch-set:serialize"
  /** Gathering the whole-project snapshot to hand across the worker seam. */
  | "search:gather-snapshot"
  /** One module was walked and its documents replaced. */
  | "search:index-module"
  | "search:build-index"
  | "search:query"
  /** One module was walked for referrers and its index slice replaced. */
  | "references:scan-module"
  /** One reference query was answered from the index, walking nothing. */
  | "references:query";

export type WorkRecord = {
  kind: WorkKind;
  /** What it was done to: a module file path, a source path, or a patch id. */
  subject?: string;
  /** For one operation that fanned out, how many things it touched. */
  count?: number;
};

/**
 * Where stores report their work.
 *
 * Positional arguments rather than a record object: this is called from inside
 * the apply loop and the listener scan, and the noop implementation should not
 * force an allocation at every call site to throw it away.
 */
export interface ActivitySink {
  work(kind: WorkKind, subject?: string, count?: number): void;
}

/** The production default: stores are instrumented, and nobody is listening. */
export const noopActivity: ActivitySink = {
  work: () => {},
};

/**
 * Records work in order, and answers the question tests actually ask, which is
 * "how many times, since here".
 *
 * `seq` is a shared clock with the event ledger, so a failure dump can show work
 * interleaved with the events that caused it. Reading "patch:create →
 * source:clone-module → source:apply-patch → source:wake-listener →
 * source:patch-apply" is what makes a redundant unit of work obvious; a bare
 * count tells you the number is wrong but not where it came from.
 */
export class RecordingActivity implements ActivitySink {
  readonly records: (WorkRecord & { seq: number })[] = [];

  constructor(private readonly nextSeq: () => number) {}

  work(kind: WorkKind, subject?: string, count?: number): void {
    this.records.push({ kind, subject, count, seq: this.nextSeq() });
  }

  /** A position to count from, so a test asks about a window, not all history. */
  position(): number {
    return this.records.length;
  }

  count(
    kind: WorkKind,
    options?: { since?: number; subject?: string },
  ): number {
    const since = options?.since ?? 0;
    let total = 0;
    for (let index = since; index < this.records.length; index++) {
      const record = this.records[index];
      if (record.kind !== kind) continue;
      if (
        options?.subject !== undefined &&
        record.subject !== options.subject
      ) {
        continue;
      }
      total++;
    }
    return total;
  }

  /**
   * Every kind seen since `since`, with counts.
   *
   * For failure messages and for exploring: asserting a specific count requires
   * knowing which kinds fired at all, and a test that has just failed is exactly
   * when that is worth printing.
   */
  summary(since = 0): Record<string, number> {
    const totals: Record<string, number> = {};
    for (let index = since; index < this.records.length; index++) {
      const { kind } = this.records[index];
      totals[kind] = (totals[kind] ?? 0) + 1;
    }
    return totals;
  }
}
