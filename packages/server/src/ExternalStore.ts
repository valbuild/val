import type { Json, ModuleFilePath } from "@valbuild/core";
import {
  isExternalResult,
  type ErasedExternalAdapter,
  type ExternalAuthor,
  type ExternalBinding,
  type ExternalCtx,
  type ExternalDefinition,
  type ExternalIssue,
  type ExternalKeyPage,
  type ExternalRecords,
  type ExternalSearchPage,
  type ExternalSort,
  type Returns,
} from "./externalRecords";

/**
 * Calling adapters: retry, transaction scope, and turning what comes back into
 * something the rest of the server can hold.
 *
 * Split from `externalRecords.ts` for the same reason `ValOps` is split from
 * `ValServer`: that file is the contract an adapter author reads, and it should
 * stay readable as one. This one is the machinery.
 *
 * The one design decision worth stating up front is where the retry loop sits,
 * because it is not the same in both configurations:
 *
 * - **With `around`**, the loop wraps the WHOLE scope. A database aborts its
 *   transaction on the first error and answers everything after it with
 *   "current transaction is aborted", so retrying the failed statement inside a
 *   dead transaction fails every time. The scope is re-entered from the top,
 *   which is also why `put` has to be an upsert and `delete` has to tolerate an
 *   absent key.
 * - **Without `around`**, the loop wraps each individual call. There is no
 *   scope to invalidate, so repeating one request is both correct and far
 *   cheaper than repeating the five that preceded it.
 *
 * `invoke` hides that difference from every caller: a scope body calls it and
 * gets a value back, and where the retrying happened is not its business.
 */

/** What a completed adapter operation gives the server. */
export type ExternalOpResult<T> =
  | { status: "success"; value: T; warnings: ExternalIssue[] }
  | { status: "error"; error: ExternalIssue; warnings: ExternalIssue[] };

export type ExternalCallOpts = {
  /** Who is editing, threaded from the Val session. */
  author?: ExternalAuthor;
};

/**
 * Thrown by `invoke` when an operation fails, so a scope body reads as if
 * nothing can fail. Never escapes `scope()`.
 */
class ExternalOpFailure extends Error {
  constructor(readonly issue: ExternalIssue) {
    super(issue.message);
    this.name = "ExternalOpFailure";
  }
}

/** One adapter method call, from the body of a scope. */
type Invoke = <R>(
  fn: (ctx: ExternalCtx<unknown>) => Promise<Returns<R>>,
) => Promise<R>;

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_COUNT_PAGE_LIMIT = 200;
/** What Val asks for when the adapter has not said how much it can serve. */
const DEFAULT_PAGE_SIZE = 100;

function defaultBackoff(attempt: number): number {
  // 200ms, 400ms, 800ms — enough to outlast a leader election, short enough
  // that an editor does not think the Studio has hung.
  return 200 * 2 ** (attempt - 1);
}

function messageOf(thrown: unknown): string {
  if (thrown instanceof Error) {
    return thrown.message;
  }
  if (typeof thrown === "string") {
    return thrown;
  }
  try {
    return JSON.stringify(thrown);
  } catch {
    return String(thrown);
  }
}

/**
 * How long to wait before attempt `attempt + 1`, or `false` to give up.
 *
 * A thrown error is never retried, wherever the policy would have allowed it:
 * Val cannot tell a rate limit from a `TypeError`, and retrying a bug three
 * times only fails slower. An adapter that knows better returns `err({
 * retryable: true })` instead of throwing.
 */
function nextDelay(
  retry: ExternalDefinition<unknown>["retry"],
  attempt: number,
  issue: ExternalIssue,
): number | false {
  if (retry === false) {
    return false;
  }
  if (issue.retryable !== true) {
    return false;
  }
  if (typeof retry === "function") {
    return retry(attempt, issue);
  }
  const attempts = retry?.attempts ?? DEFAULT_ATTEMPTS;
  if (attempt >= attempts) {
    return false;
  }
  return (retry?.backoff ?? defaultBackoff)(attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The registry, as the server uses it.
 *
 * Holds no state of its own beyond the bindings: an adapter is free to cache,
 * and Val deliberately does not cache on its behalf — a stale read here would
 * show an editor content that no longer exists.
 */
export class ExternalStore {
  private readonly byModule: Map<ModuleFilePath, ExternalBinding>;

  constructor(private readonly records: ExternalRecords) {
    this.byModule = new Map(
      Object.values(records.bindings).map((binding) => [
        binding.moduleFilePath,
        binding,
      ]),
    );
  }

  /** Every label the project bound, in registration order. */
  labels(): string[] {
    return Object.keys(this.records.bindings);
  }

  bindingOfLabel(label: string): ExternalBinding | undefined {
    return this.records.bindings[label];
  }

  bindingOf(moduleFilePath: ModuleFilePath): ExternalBinding | undefined {
    return this.byModule.get(moduleFilePath);
  }

  has(moduleFilePath: ModuleFilePath): boolean {
    return this.byModule.has(moduleFilePath);
  }

  /**
   * The most keys to ask for in one call to `keys`, and the most to pass to one
   * `get`.
   *
   * Chunking hints, not ceilings: a caller asks for what it wants and this
   * decides how many calls that takes. See `maxPageSize` on the adapter.
   */
  private pageSizeOf(adapter: ErasedExternalAdapter): number {
    return adapter.maxPageSize ?? DEFAULT_PAGE_SIZE;
  }

  private batchSizeOf(adapter: ErasedExternalAdapter): number {
    return adapter.maxBatchSize ?? DEFAULT_PAGE_SIZE;
  }

  /**
   * Run `body` against one binding, with the retry scope the definition implies.
   *
   * Everything an adapter does goes through here, which is what makes "one
   * transaction per request" true rather than aspirational: a body that issues
   * five chunked calls issues them inside one `around`.
   */
  private async scope<T>(
    binding: ExternalBinding,
    opts: ExternalCallOpts,
    body: (invoke: Invoke, adapter: ErasedExternalAdapter) => Promise<T>,
  ): Promise<ExternalOpResult<T>> {
    const { around, retry } = this.records.definition;
    const warnings: ExternalIssue[] = [];

    /** Normalize one `Returns<R>`, collecting warnings, throwing on failure. */
    const settle = <R>(returned: Returns<R>): R => {
      if (!isExternalResult(returned)) {
        return returned;
      }
      if (returned.kind === "err") {
        throw new ExternalOpFailure(returned.error);
      }
      if (returned.warnings) {
        warnings.push(...returned.warnings);
      }
      return returned.value;
    };

    const ctxFor = (tx: unknown, attempt: number): ExternalCtx<unknown> => ({
      moduleFilePath: binding.moduleFilePath,
      attempt,
      tx,
      ...(opts.author !== undefined ? { author: opts.author } : {}),
    });

    if (around === undefined) {
      // No scope to invalidate: retry each call on its own.
      const invoke: Invoke = async (fn) => {
        for (let attempt = 1; ; attempt++) {
          let issue: ExternalIssue;
          try {
            return settle(await fn(ctxFor(undefined, attempt)));
          } catch (e) {
            if (e instanceof ExternalOpFailure) {
              issue = e.issue;
            } else {
              throw e;
            }
          }
          const delay = nextDelay(retry, attempt, issue);
          if (delay === false) {
            throw new ExternalOpFailure(issue);
          }
          await sleep(delay);
        }
      };
      try {
        return {
          status: "success",
          value: await body(invoke, binding.adapter),
          warnings,
        };
      } catch (e) {
        return {
          status: "error",
          error:
            e instanceof ExternalOpFailure
              ? e.issue
              : { message: messageOf(e), retryable: false, cause: e },
          warnings,
        };
      }
    }

    // A transaction is dead after its first error, so the unit of retry is the
    // whole scope.
    for (let attempt = 1; ; attempt++) {
      // Warnings from an attempt that is about to be discarded describe work
      // that was rolled back with it.
      warnings.length = 0;
      let issue: ExternalIssue;
      try {
        const value = await around(async (tx) => {
          const invoke: Invoke = async (fn) =>
            settle(await fn(ctxFor(tx, attempt)));
          return body(invoke, binding.adapter);
        });
        return { status: "success", value, warnings };
      } catch (e) {
        issue =
          e instanceof ExternalOpFailure
            ? e.issue
            : { message: messageOf(e), retryable: false, cause: e };
      }
      const delay = nextDelay(retry, attempt, issue);
      if (delay === false) {
        return { status: "error", error: issue, warnings };
      }
      await sleep(delay);
    }
  }

  private notBound(moduleFilePath: ModuleFilePath): ExternalOpResult<never> {
    return {
      status: "error",
      error: {
        message: `No external adapter is bound for '${moduleFilePath}'`,
        retryable: false,
      },
      warnings: [],
    };
  }

  /**
   * A page of keys.
   *
   * `limit` is what the CALLER wants. A store that will only list ten at a time
   * says so with `maxPageSize`, and this issues as many calls as that takes —
   * inside one scope. The cursor returned is the store's own, from the last
   * call made, so paging continues exactly where this page stopped.
   */
  async keys(
    moduleFilePath: ModuleFilePath,
    args: { cursor: string | null; limit: number; sort?: ExternalSort },
    opts: ExternalCallOpts = {},
  ): Promise<ExternalOpResult<ExternalKeyPage>> {
    const binding = this.bindingOf(moduleFilePath);
    if (!binding) {
      return this.notBound(moduleFilePath);
    }
    return this.scope(binding, opts, async (invoke, adapter) => {
      const pageSize = this.pageSizeOf(adapter);
      const keys: string[] = [];
      let cursor = args.cursor;
      while (keys.length < args.limit) {
        const want = Math.min(pageSize, args.limit - keys.length);
        const page: ExternalKeyPage = await invoke((ctx) =>
          adapter.keys({ cursor, limit: want, sort: args.sort }, ctx),
        );
        keys.push(...page.keys);
        cursor = page.cursor;
        // Two ways a store says "that is all": a null cursor, or a short page.
        // Trusting only the first loops forever against a store that forgets to
        // null it, which is a mistake worth surviving rather than reporting.
        if (cursor === null || page.keys.length === 0) {
          return { keys, cursor: null };
        }
      }
      return { keys, cursor };
    });
  }

  /**
   * Entry content, by key.
   *
   * A key the store does not have comes back as `null` rather than absent, so a
   * caller can tell "no such entry" from "the adapter forgot it".
   */
  async get(
    moduleFilePath: ModuleFilePath,
    keys: string[],
    opts: ExternalCallOpts = {},
  ): Promise<ExternalOpResult<Record<string, Json | null>>> {
    const binding = this.bindingOf(moduleFilePath);
    if (!binding) {
      return this.notBound(moduleFilePath);
    }
    if (keys.length === 0) {
      return { status: "success", value: {}, warnings: [] };
    }
    return this.scope(binding, opts, async (invoke, adapter) => {
      const batchSize = this.batchSizeOf(adapter);
      const out: Record<string, Json | null> = {};
      for (let i = 0; i < keys.length; i += batchSize) {
        const chunk = keys.slice(i, i + batchSize);
        const got = await invoke((ctx) => adapter.get(chunk, ctx));
        for (const key of chunk) {
          out[key] = got[key] ?? null;
        }
      }
      return out;
    });
  }

  /**
   * How many entries there are.
   *
   * Three answers, and the caller has to be able to tell them apart: a number
   * the store gave, a number Val counted (with `exact: false` once the walk hit
   * `countPageLimit`, so a pager can say "200,000+"), and "declined", which is
   * what `count: false` means. Declined is not zero, and rendering it as zero
   * is the bug this shape exists to prevent.
   */
  async count(
    moduleFilePath: ModuleFilePath,
    opts: ExternalCallOpts = {},
  ): Promise<
    ExternalOpResult<
      | { status: "counted"; count: number; exact: boolean }
      | { status: "declined" }
    >
  > {
    const binding = this.bindingOf(moduleFilePath);
    if (!binding) {
      return this.notBound(moduleFilePath);
    }
    return this.scope(binding, opts, async (invoke, adapter) => {
      if (adapter.count === false) {
        return { status: "declined" };
      }
      const delegate = adapter.count;
      if (delegate !== undefined) {
        return {
          status: "counted",
          count: await invoke((ctx) => delegate(ctx)),
          exact: true,
        };
      }
      // Derived: page the keys and sum. Keys only — it never fetches content.
      const pageSize = this.pageSizeOf(adapter);
      const limit =
        this.records.definition.countPageLimit ?? DEFAULT_COUNT_PAGE_LIMIT;
      let cursor: string | null = null;
      let count = 0;
      for (let page = 0; page < limit; page++) {
        const got: ExternalKeyPage = await invoke((ctx) =>
          adapter.keys({ cursor, limit: pageSize }, ctx),
        );
        count += got.keys.length;
        cursor = got.cursor;
        if (cursor === null || got.keys.length === 0) {
          return { status: "counted", count, exact: true };
        }
      }
      return { status: "counted", count, exact: false };
    });
  }

  /**
   * Delegated search.
   *
   * Only the adapter's own `search` runs here. Omitted means Val answers from
   * what it has already paged (see `deriveSearch`, which needs no adapter at
   * all), and `false` means the editor is told search is unavailable — never
   * that there were no matches.
   */
  async search(
    moduleFilePath: ModuleFilePath,
    query: {
      text: string;
      cursor: string | null;
      limit: number;
      sort?: ExternalSort;
    },
    opts: ExternalCallOpts = {},
  ): Promise<
    ExternalOpResult<
      | { status: "delegated"; page: ExternalSearchPage<Json> }
      | { status: "declined" }
      | { status: "derive" }
    >
  > {
    const binding = this.bindingOf(moduleFilePath);
    if (!binding) {
      return this.notBound(moduleFilePath);
    }
    return this.scope(binding, opts, async (invoke, adapter) => {
      if (adapter.search === false) {
        return { status: "declined" };
      }
      const delegate = adapter.search;
      if (delegate === undefined) {
        return { status: "derive" };
      }
      return {
        status: "delegated",
        page: await invoke((ctx) => delegate(query, ctx)),
      };
    });
  }

  /**
   * The store's version token, if it has one.
   *
   * Absent costs freshness, never function, so this answers `null` rather than
   * failing — a poll that cannot get a version simply learns nothing.
   */
  async version(
    moduleFilePath: ModuleFilePath,
    opts: ExternalCallOpts = {},
  ): Promise<ExternalOpResult<string | null>> {
    const binding = this.bindingOf(moduleFilePath);
    if (!binding) {
      return this.notBound(moduleFilePath);
    }
    return this.scope(binding, opts, async (invoke, adapter) => {
      const version = adapter.version;
      if (version === undefined) {
        return null;
      }
      return invoke((ctx) => version(ctx));
    });
  }

  /** Read bytes back out of the store, by the path the ref carries. */
  async getFile(
    moduleFilePath: ModuleFilePath,
    path: string,
    opts: ExternalCallOpts = {},
  ): Promise<ExternalOpResult<Uint8Array | null>> {
    const binding = this.bindingOf(moduleFilePath);
    if (!binding) {
      return this.notBound(moduleFilePath);
    }
    return this.scope(binding, opts, async (invoke, adapter) => {
      // `presigned` may decline to serve bytes at all — a store the browser can
      // reach and the app cannot is legitimate — so the absence is reported as
      // its own thing rather than as a misconfiguration.
      const get = adapter.files?.get;
      if (get === undefined) {
        throw new ExternalOpFailure({
          message:
            adapter.files === undefined
              ? `The adapter for '${binding.label}' stores media but has no files`
              : `The adapter for '${binding.label}' has files.type "${adapter.files.type}" with no get: it cannot hand back bytes, only a URL`,
          retryable: false,
        });
      }
      return invoke((ctx) => get(path, ctx));
    });
  }
}
