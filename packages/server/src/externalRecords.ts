import type {
  ExternalItemOf,
  ExternalLabelOf,
  ExternalReadonlyOf,
  ExternalRecordSrc,
  InferValModuleType,
  Json,
  JsonOf,
  ModuleFilePath,
  ValModule,
} from "@valbuild/core";

/**
 * The type surface of an external record's adapter.
 *
 * Nothing here runs: phase 0 is the contract, and the registry that executes it
 * arrives with the read endpoints. What the contract has to get right now is the
 * shape, because every adapter written against it is a compatibility promise.
 *
 * Four kinds of method, and each is required or not for one reason:
 *
 * - **Read** — `keys`, `get`. Cannot be built out of anything else, so always
 *   required.
 * - **Write** — `put`, `delete`. Likewise, and they move together: required on a
 *   writable record, forbidden on a `.readonly()` one.
 * - **Derived** — `count`, `search`. Computable from the read methods, so
 *   omitting one costs performance, never capability. `false` declines the
 *   fallback; that is the only thing `false` ever means here.
 * - **Media** — `putFile`, `getFile`. A pair, and required by the item SCHEMA
 *   rather than by this type (see `hasMediaSchema`).
 */

// #region result

/**
 * Brands the result envelope so a bare value can be accepted alongside it.
 *
 * A symbol rather than a property name because `get` returns
 * `Record<key, Item>` — a record that can perfectly well contain a key called
 * `kind`. The envelope never crosses the wire (it travels in-process between
 * adapter and Val), so there is no serialization cost to it.
 */
export const EXTERNAL_RESULT = Symbol.for("@valbuild/server/ExternalResult");

export type ExternalIssue = {
  message: string;
  /**
   * Whether repeating the operation could succeed.
   *
   * Only the adapter can tell a transient 429 from a permanent 404, so only the
   * adapter sets this. A THROWN error is never retried: Val cannot tell a rate
   * limit from a `TypeError`, and retrying a bug three times only fails slower.
   */
  retryable?: boolean;
  /** Names the entry when the problem is one key's, not the whole call's. */
  key?: string;
  cause?: unknown;
};

export type ExternalResult<T> = { readonly [EXTERNAL_RESULT]: true } & (
  | { kind: "ok"; value: T; warnings?: ExternalIssue[] }
  | { kind: "err"; error: ExternalIssue }
);

/**
 * What every adapter method may return: the value on its own, or the envelope.
 *
 * A bare value means "ok, nothing to report", which keeps the common path one
 * line. Errors can be thrown instead of returned — the envelope is for a failure
 * worth classifying, or a success worth annotating.
 */
export type Returns<T> = T | ExternalResult<T>;

/**
 * Wrap a value as a successful result, optionally with warnings.
 *
 * `NoInfer` is load-bearing, not decoration. Without it `T` is inferred FROM the
 * argument, and an object literal that infers its own type is not contextually
 * typed by the adapter's contract — so `title` inside `ok({ a: { title } })` is a
 * fresh property that happens to be named `title`, with no declaration link back
 * to `title: s.string()` in the schema. "Find all references" on the schema field
 * then stops at the page that reads it and never reaches the adapter that
 * produces it. `NoInfer` blocks that inference, leaving the contextual return
 * type as the only source for `T`, which is what restores the link (and, as a
 * bonus, makes a typo report the offending property rather than the whole
 * return value).
 *
 * `externalNavigation.test.ts` guards this; nothing else would notice.
 *
 * The cost: `ok(...)` in a position with NO contextual type — a helper without a
 * return type annotation — infers `unknown` instead of the argument's type, and
 * fails where the helper is used rather than where it is written. Annotate the
 * helper's return type, or inline it.
 */
export function ok<T>(
  value: NoInfer<T>,
  warnings?: ExternalIssue[],
): ExternalResult<T> {
  return warnings && warnings.length > 0
    ? { [EXTERNAL_RESULT]: true, kind: "ok", value, warnings }
    : { [EXTERNAL_RESULT]: true, kind: "ok", value };
}

export function err(issue: ExternalIssue): ExternalResult<never> {
  return { [EXTERNAL_RESULT]: true, kind: "err", error: issue };
}

export function isExternalResult<T>(
  value: Returns<T>,
): value is ExternalResult<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [EXTERNAL_RESULT]?: unknown })[EXTERNAL_RESULT] === true
  );
}

// #endregion

// #region context

export type ExternalAuthor = {
  /** Always present. */
  id: string;
  /**
   * Present when Val knows it — the profile shape has it optional, so an
   * adapter keying only on email would break for a user without one.
   */
  email?: string;
};

/**
 * What every adapter method is told about the call it is serving.
 *
 * `tx` is present only when the adapter declared an `around`; a store with no
 * transaction seam has nothing to put there and nothing to ignore.
 */
export type ExternalCtx<Tx> = {
  moduleFilePath: ModuleFilePath;
  /** Who is editing. Anything richer is the adapter's to resolve. */
  author?: ExternalAuthor;
  /**
   * 1 on the first call, 2 on the first retry.
   *
   * Not only for logging: an adapter can widen a timeout, skip a read replica
   * that may be lagging, bypass a cache, or give up on its own terms.
   */
  attempt: number;
} & ([Tx] extends [never] ? { tx?: undefined } : { tx: Tx });

// #endregion

// #region paging, sorting, searching

export type ExternalKeyPage = {
  keys: string[];
  /** `null` means this was the last page. */
  cursor: string | null;
};

/**
 * How a page should be ordered.
 *
 * Records are unordered today and sorting is coming; the parameter lands now
 * because adding one to `keys` later would break every adapter that exists by
 * then. Val passes `undefined` until sorting ships, and an adapter may ignore it.
 *
 * Two rules for whoever implements it:
 *
 * - **A cursor is only valid for the sort that issued it.** Key-ordered paging
 *   is `where key > cursor`; sorted paging is `where (field, key) > (…, …)`.
 *   Val pairs the cursor with a hash of the sort and restarts rather than
 *   replaying a mismatched one.
 * - **The key is always the last sort term.** Ordering by a non-unique field
 *   without a tiebreaker lets rows shift between pages, so page 2 can skip or
 *   repeat an entry while both pages look fine on their own.
 */
export type ExternalSort = {
  /**
   * A path into the ITEM: `["publishedAt"]`, `["author", "name"]`. Absent means
   * order by the entry key, which is the only order there is today.
   */
  path?: string[];
  direction: "asc" | "desc";
};

export type ExternalSearchHit<Item> = {
  key: string;
  /**
   * Where it matched, relative to the item. A store that only knows "this row
   * matched" omits it; the Studio uses it to show the field, not just the row.
   */
  path?: string[];
  /**
   * The entry as the store has it.
   *
   * Val applies pending patches on top before deciding the hit still stands —
   * which is the whole reason to return it. A delegated search sees only
   * PUBLISHED content, so without the value there is no way to drop a hit whose
   * draft edit removed the matching text.
   */
  value?: Item;
};

export type ExternalSearchPage<Item> = {
  hits: ExternalSearchHit<Item>[];
  cursor: string | null;
};

// #endregion

// #region media

export type ExternalFile = {
  /**
   * The path Val chose — `${directory}/${createFilename(...)}` — which is the
   * same name a local or remote file would have got.
   *
   * An INPUT, not something the adapter invents: the stored ref embeds this
   * path, so a gallery can be moved back to local storage by writing the bytes
   * where the ref already says they belong.
   */
  path: string;
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  /** Content address. Make `putFile` idempotent on it, so a retry re-uses. */
  sha256: string;
};

// #endregion

// #region the adapter

type AnyExternalModule = ValModule<ExternalRecordSrc>;

/** Read methods. Always required. */
type ReadMethods<Item, Tx> = {
  keys(
    args: { cursor: string | null; limit: number; sort?: ExternalSort },
    ctx: ExternalCtx<Tx>,
  ): Promise<Returns<ExternalKeyPage>>;

  get(
    keys: string[],
    ctx: ExternalCtx<Tx>,
  ): Promise<Returns<Record<string, Item | null>>>;
};

/**
 * Write methods. Required together, and forbidden together on `.readonly()`.
 *
 * `put` must be an UPSERT keyed by the entry key and `delete` must tolerate an
 * absent key, because a publish may be replayed: retry re-runs the whole scope
 * where there is a transaction, and the individual call where there is not.
 */
type WriteMethods<Item, Tx> = {
  put(
    entries: Record<string, Item>,
    ctx: ExternalCtx<Tx> & {
      /**
       * What `putFile` returned, keyed by the path it was given.
       *
       * Path rather than sha256 because the entry references its file by path
       * and carries no hash — keying by hash would need a second map. The sha is
       * a field, for an adapter doing content-addressed bookkeeping.
       */
      uploads: Record<string, { sha256: string; data?: Json }>;
    },
  ): Promise<Returns<void>>;

  delete(keys: string[], ctx: ExternalCtx<Tx>): Promise<Returns<void>>;
};

/**
 * Named so the compiler prints the reason. A bare `never` would report only
 * "not assignable to type 'undefined'", which tells nobody anything.
 */
export type ReadonlyRecordHasNoWrites = {
  readonly __val_error: "this record is .readonly(): remove put and delete, or remove .readonly() from the schema";
};

/** Derived and media methods, and the sort declaration. */
type OptionalMethods<Item, Tx> = {
  /**
   * Three modes. A function delegates; `false` declines; omitted means Val
   * counts by paging `keys` and summing, cached and bounded.
   */
  count?: false | ((ctx: ExternalCtx<Tx>) => Promise<Returns<number>>);

  /**
   * Three modes, as `count`. Omitted, Val answers from the entries it has
   * already seen and labels the result partial — it does not fetch a whole store
   * on the editor's behalf. `false` declines even that.
   */
  search?:
    | false
    | ((
        query: {
          text: string;
          cursor: string | null;
          limit: number;
          sort?: ExternalSort;
        },
        ctx: ExternalCtx<Tx>,
      ) => Promise<Returns<ExternalSearchPage<Item>>>);

  /**
   * Which item paths this store can order by. `true` for any field. Absent
   * means key order only — all any store can promise, and all a bucket can do.
   */
  sortable?: true | string[][];

  /**
   * The most keys this store will list per call, and the most one `get` may
   * carry.
   *
   * Chunking hints for the fetcher, NOT ceilings the UI sees: if the Studio asks
   * for 50 and the store lists 10 at a time, Val makes five calls and returns
   * 50. Page size belongs to the Studio, which must not be able to tell how a
   * record is stored.
   */
  maxPageSize?: number;
  maxBatchSize?: number;

  /**
   * A token that changes when anything in this record changes — `max(updated_at)`,
   * a sequence number, an ETag. Polled on the poll that already exists. Absent
   * costs freshness, never function: Val re-reads on navigation.
   */
  version?(ctx: ExternalCtx<Tx>): Promise<Returns<string>>;

  /** Stores bytes at the path Val chose. Paired with `getFile`. */
  putFile?(
    file: ExternalFile,
    ctx: ExternalCtx<Tx>,
  ): Promise<Returns<{ data?: Json }>>;

  /** Reads them back. If an adapter can store bytes it must return them. */
  getFile?(
    path: string,
    ctx: ExternalCtx<Tx>,
  ): Promise<Returns<Uint8Array | null>>;
};

/** The item type an external module's entries hold, loosened as JSON allows. */
export type ItemOfModule<M extends AnyExternalModule> = JsonOf<
  ExternalItemOf<InferValModuleType<M>>
>;

/**
 * The adapter a given external module needs.
 *
 * Writes are required or forbidden by the module's own `.readonly()`, read off
 * the source marker's phantom.
 */
export type AdapterFor<M extends AnyExternalModule, Tx> = ReadMethods<
  ItemOfModule<M>,
  Tx
> &
  OptionalMethods<ItemOfModule<M>, Tx> &
  (ExternalReadonlyOf<InferValModuleType<M>> extends true
    ? {
        put?: ReadonlyRecordHasNoWrites;
        delete?: ReadonlyRecordHasNoWrites;
      }
    : WriteMethods<ItemOfModule<M>, Tx>);

declare const BoundTag: unique symbol;
/** What `entry()` returns: a module and its adapter, checked against each other. */
export type BoundExternalRecord<M> = { readonly [BoundTag]: M };

export type ExternalRecords = {
  readonly __brand: "ExternalRecords";
};

export type ExternalBuilder<Tx> = {
  /**
   * Bind an adapter to a module.
   *
   * A call rather than an object literal on purpose: `module` is inferred from
   * the first argument, so `AdapterFor` RESOLVES for the second and TypeScript
   * records the declaration link between a schema field and the adapter that
   * produces it. Inside a single object literal the module stays a deferred type
   * parameter, the adapter type never resolves, and "find all references" on a
   * schema field stops reaching the adapter.
   */
  entry<M extends AnyExternalModule>(
    module: M,
    adapter: AdapterFor<M, Tx>,
  ): BoundExternalRecord<M>;

  /**
   * Collect the bindings. The key must equal the schema's own `.external(label)`.
   */
  modules<E extends Record<string, BoundExternalRecord<AnyExternalModule>>>(
    entries: E & {
      [K in keyof E]: E[K] extends BoundExternalRecord<
        infer M extends AnyExternalModule
      >
        ? ExternalLabelOf<InferValModuleType<M>> extends K
          ? E[K]
          : BoundExternalRecord<
              ValModule<ExternalRecordSrc<unknown, K & string>>
            >
        : never;
    },
  ): ExternalRecords;
};

export type ExternalDefinition<Tx> = {
  /**
   * One scope per request, so a 50-key batch is one transaction and one query
   * rather than fifty. Composes with any `withTransaction(cb)` API.
   *
   * Optional: a store with no transaction seam — a bucket, a REST API — simply
   * omits it, and `ctx` then has no `tx`.
   *
   * Retry scope follows from this. WITH `around`, Val re-enters the whole scope,
   * because a database aborts a transaction on its first error and answers
   * everything after it with "current transaction is aborted". WITHOUT it, Val
   * repeats the single operation, which is both correct and far cheaper.
   */
  around?: <R>(run: (tx: Tx) => Promise<R>) => Promise<R>;

  /**
   * Retry policy. Return the delay in ms, or `false` to give up.
   *
   * A policy function, not a re-implementation of the loop. Defaults to three
   * attempts with exponential backoff. `false` disables retries entirely.
   */
  retry?:
    | false
    | { attempts: number; backoff?: (attempt: number) => number }
    | ((attempt: number, issue: ExternalIssue) => number | false);

  /** Fired after a publish, so an app that caches can purge what changed. */
  onPublished?: (event: {
    label: string;
    keys: string[];
  }) => Promise<void> | void;

  /**
   * How far the derived `count` walk may page before answering "200,000+".
   * Keys only — it never fetches entry content.
   */
  countPageLimit?: number;
};

/**
 * Declare the adapters for this project's external records.
 *
 * `Tx` is given explicitly: `around` offers the compiler no inference site,
 * since `run` is a callback you CALL rather than one whose signature you write.
 * One type argument, in one place, and every inline adapter then gets `tx`,
 * `cursor`, `limit` and the row shape correctly typed.
 *
 * @example
 * const { entry, modules } = defineExternal<typeof sql>({
 *   around: (run) => sql.begin(run),
 * });
 *
 * export default modules({
 *   posts: entry(postsVal, { keys, get, put, delete: del, search: false }),
 * });
 *
 * @example a store with no transaction
 * const { entry, modules } = defineExternal();
 */
export function defineExternal<Tx = never>(
  definition?: ExternalDefinition<Tx>,
): ExternalBuilder<Tx> {
  void definition;
  throw new Error(
    "defineExternal is not implemented yet: phase 0 lands the contract, the registry that executes it arrives with the read endpoints.",
  );
}
