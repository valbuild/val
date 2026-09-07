import { Internal } from "@valbuild/core";
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
 * This file is the contract plus the registry `defineExternal` builds from it.
 * Calling adapters — retry, transaction scope, chunking — lives in
 * `ExternalStore.ts`, so that what an adapter author has to read stays readable
 * as one file.
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
 * - **Media** — one `files` field holding a tagged union, required by the item
 *   SCHEMA rather than by this type (see `hasMediaSchema`). A union rather than
 *   a bag of optional methods so that a write path without its read path is
 *   unrepresentable, and so the discriminant can be read at startup without
 *   calling anything.
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
  /** Content address. Make the write idempotent on it, so a retry re-uses. */
  sha256: string;
};

/**
 * What Val knows about a file it is about to have uploaded, when it will not be
 * carrying the bytes itself.
 *
 * The same fields as `ExternalFile` minus `bytes`, plus `size` — because the
 * signature is the only place a limit can be enforced once Val is out of the
 * path, and a signer that cannot see the bytes still needs to be able to refuse
 * a 4 GB one.
 */
export type ExternalUploadRequest = Omit<ExternalFile, "bytes"> & {
  size: number;
};

/**
 * Permission to write one file, in the shape the object stores actually want.
 *
 * S3 and R2 presigned PUTs need a URL and headers; an S3 POST policy needs form
 * fields sent before the file; GCS signed URLs are a PUT; Azure wants a SAS URL
 * plus `x-ms-blob-type`; Cloudinary and Uploadcare are POSTs with a signature in
 * the fields. One shape covers all of them, and an adapter needing none of the
 * optional parts returns a URL.
 */
export type ExternalUploadAuthorization = {
  url: string;
  /** Default `"PUT"`. */
  method?: "PUT" | "POST";
  headers?: Record<string, string>;
  /** A POST policy's form fields, sent before the file. */
  fields?: Record<string, string>;
  /** Where the bytes go in a POST. Default `"file"`. */
  fileField?: string;
  /** Val will not reuse the signature past this. */
  expiresAt?: string;
  /** → `ctx.uploads[path].data` on the `put` that follows. */
  data?: Json;
};

/**
 * How this record's media is stored, as a tagged union.
 *
 * The choice is driven by one question — **does the host cap request bodies?**
 * Vercel, Netlify, Lambda and Cloudflare Pages do; a VPS, Docker, Fly and a
 * self-hosted Node server do not. `checkExternalSetup` reads `type` at startup
 * and says so, to the people it concerns and nobody else.
 *
 * A union rather than four optional sibling methods because it makes the two
 * mistakes unrepresentable: a write path without a read path, and a pair drawn
 * from different strategies.
 */
export type ExternalFiles<Tx> =
  | {
      /**
       * Val hands the adapter the bytes and asks for them back.
       *
       * Right for local development (always), a self-hosted server, a blob
       * column, and a store on a private network the browser cannot reach.
       * Every byte passes through `/api/val/…`, so on a host that caps request
       * bodies this fails for a large file — in both directions.
       */
      type: "bytes";
      /** Stores bytes at the path Val chose. Idempotent on `sha256`. */
      put(
        file: ExternalFile,
        ctx: ExternalCtx<Tx>,
      ): Promise<Returns<{ data?: Json }>>;
      /** Reads them back. If an adapter can store bytes it must return them. */
      get(
        path: string,
        ctx: ExternalCtx<Tx>,
      ): Promise<Returns<Uint8Array | null>>;
    }
  | {
      /**
       * Val never holds the bytes: the adapter authorises an upload, and
       * resolves a URL to read one back.
       *
       * No size ceiling in either direction, and a published read never touches
       * the app server. The right answer for S3, R2, GCS, Azure, Cloudinary and
       * anything with a CDN in front of it.
       */
      type: "presigned";
      signUpload(
        request: ExternalUploadRequest,
        ctx: ExternalCtx<Tx>,
      ): Promise<Returns<ExternalUploadAuthorization>>;
      /**
       * Where a published file is served from — a public CDN URL, or a signed
       * GET. `null` means this path holds nothing.
       */
      url(
        path: string,
        ctx: ExternalCtx<Tx>,
      ): Promise<Returns<{ url: string; expiresAt?: string } | null>>;
      /**
       * Bytes through the server anyway, for the callers that need them rather
       * than a URL — `val validate` reading a file to check it, for one.
       * Optional because a store the app itself cannot read is legitimate.
       */
      get?(
        path: string,
        ctx: ExternalCtx<Tx>,
      ): Promise<Returns<Uint8Array | null>>;
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
       * What the media write returned — `files.put`, or `files.signUpload` —
       * keyed by the path it was given.
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

  /**
   * How this record's media is stored. Required when the item schema holds an
   * image or a file, which is checked against the SCHEMA at startup rather than
   * here — a gallery stores files under keys this type never sees.
   */
  files?: ExternalFiles<Tx>;
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

/**
 * The adapter as the SERVER calls it: the same methods with `Item` and `Tx`
 * erased.
 *
 * The precise types are for the person writing the adapter — they are what make
 * a wrong row shape a compile error at the right token. The server, which holds
 * a registry of adapters for many different modules, cannot name those types and
 * does not need to: it validates what comes back against the serialized schema,
 * which is the only check that still holds once a value has crossed a wire.
 */
export type ErasedExternalAdapter = ReadMethods<Json, unknown> &
  OptionalMethods<Json, unknown> &
  Partial<WriteMethods<Json, unknown>>;

/** One binding, as the registry holds it. */
export type ExternalBinding = {
  /** The label it was registered under — the key in `modules({ ... })`. */
  label: string;
  /** Which module it adapts, for the startup check and for error messages. */
  moduleFilePath: ModuleFilePath;
  adapter: ErasedExternalAdapter;
};

declare const BoundTag: unique symbol;
/**
 * What `entry()` returns: a module and its adapter, checked against each other.
 *
 * The runtime fields are real and readable — only the module phantom is
 * type-level — so `modules()` can collect the bindings without an assertion.
 */
export type BoundExternalRecord<M> = Omit<ExternalBinding, "label"> & {
  readonly [BoundTag]: M;
};

export type ExternalRecords = {
  readonly __brand: "ExternalRecords";
  /**
   * The bindings, by label. The label is the key `modules()` was given, which
   * the type system has already checked against each schema's own
   * `.external(label)`; the server re-checks it at startup, for the callers
   * TypeScript did not see.
   */
  readonly bindings: Readonly<Record<string, ExternalBinding>>;
  /** `around`, `retry` and the rest, with `Tx` erased. */
  readonly definition: ExternalDefinition<unknown>;
};

export function isExternalRecords(value: unknown): value is ExternalRecords {
  return (
    typeof value === "object" &&
    value !== null &&
    "__brand" in value &&
    value.__brand === "ExternalRecords"
  );
}

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
  return {
    entry: (module, adapter) => {
      const moduleFilePath = Internal.getValPath(module);
      if (moduleFilePath === undefined) {
        throw new Error(
          "entry() was given something that is not a Val module: it has no path. Pass the module's default export, e.g. entry(postsVal, { ... }).",
        );
      }
      return {
        moduleFilePath: moduleFilePath as unknown as ModuleFilePath,
        // The one assertion in this file, and it is the boundary the whole
        // design is built around: `AdapterFor<M, Tx>` names the module's item
        // type and the project's transaction type, and neither can be named
        // again by a registry that holds many modules at once. The types have
        // done their work by the time we get here — what comes back from the
        // store is checked against the serialized schema instead.
        adapter: adapter as unknown as ErasedExternalAdapter,
      } as BoundExternalRecord<typeof module>;
    },
    modules: (entries) => {
      const bindings: Record<string, ExternalBinding> = {};
      const byModule: Record<string, string> = {};
      for (const [label, bound] of Object.entries(entries)) {
        if (label in bindings) {
          throw new Error(`Duplicate external record label: '${label}'`);
        }
        const existing = byModule[bound.moduleFilePath];
        if (existing !== undefined) {
          // Two adapters for one module: whichever won would be arbitrary, and
          // the loser's queries would simply never run.
          throw new Error(
            `Module '${bound.moduleFilePath}' is bound twice, as '${existing}' and '${label}'. A module has exactly one adapter.`,
          );
        }
        byModule[bound.moduleFilePath] = label;
        bindings[label] = {
          label,
          moduleFilePath: bound.moduleFilePath,
          adapter: bound.adapter,
        };
      }
      return {
        __brand: "ExternalRecords",
        bindings,
        // `Tx` is the project's, and the registry serves every project the same
        // way: the executor passes whatever `around` hands it straight back to
        // the adapter that asked for it, so nothing here needs to know it.
        // `{}` rather than `undefined` for the store with no transaction seam
        // and no retry override — every field of a definition is optional.
        definition: definition ?? {},
      };
    },
  };
}
