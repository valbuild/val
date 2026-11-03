import {
  type JsonEntryContentOf,
  type Ready,
  type ReadEnv,
  type Resolvable,
  type ResolvedVal,
  type RouteValueOf,
  SET_AUTO_TAG_JSX_ENABLED,
  awaitResolved,
  fetchValFrom,
  isJsonValuesRecordSchema,
  resolveVal,
  resolveValEntry,
  snapshotSource,
} from "@valbuild/react/stega";
import {
  ModuleFilePath,
  ValConfig,
  ValModules,
  Internal,
  type Json,
  type ResolvableModule,
  SourceObject,
} from "@valbuild/core";
import {
  type ContentSource,
  type RequestScopedMemo,
} from "@valbuild/shared/internal";
import {
  createValServer,
  draftForRequest,
  layeredSnapshot,
  proposalSnapshot,
  proposalSnapshotForReaders,
  readDraftChanges,
  readerSchemaVersion,
  type DraftSources,
  type DraftValServer,
  type GetDraftSourcesScope,
  type ValPatchStore,
  type ValServer,
} from "@valbuild/server";
import { VERSION } from "../version";
import { getValRouteUrlFromVal, initValRouteFromVal } from "../routeFromVal";
import { valDraftMode, type ValDraftMode } from "./valDraftMode";
import type { ValDraft } from "../ValDraft";
import type { ValHttpMode } from "./initValServer";

/*
 * NOTE: no `SET_RSC(true)` here, unlike the Next package.
 *
 * That flag marks elements as having been rendered by a React Server Component
 * — a tree the browser cannot re-render, only re-request. A TanStack Start page
 * is server-RENDERED and then hydrated, so every element it produces is a
 * normal client element and the distinction does not exist.
 */

/*
 * The readers below are `resolveVal` (`@valbuild/react/stega`) over this
 * request's sources: the draft (`serverDraftSource`, in `@valbuild/server`),
 * then the proposal's or content version's snapshot, then the bundle. Only
 * the sources are TanStack's; the rule that picks between them is the same in
 * `@valbuild/next` and in the hooks. See `docs/plans/one-content-model.md`,
 * "One way to load".
 */

export type { DraftSources, DraftValServer, GetDraftSourcesScope };

/** What the draft readers read. */
export type DraftSourcesValServer = DraftValServer;

/** What the route readers need: what `fetchVal` does, the single-entry route among it. */
export type RouteReaderValServer = DraftValServer;

/**
 * The slice of `ValServer` the single-entry readers use. Narrower than
 * `ValServer` on purpose: it says what the dependency IS, and it lets a test
 * drive these readers with a one-route fake.
 */
export type JsonEntryValServer = Pick<ValServer, "/json">;

/**
 * A per-request memo box, keyed on the `Request` itself.
 *
 * That is what makes this safe: TanStack resolves one `Request` object per
 * in-flight request out of async local storage, so two visitors cannot collide,
 * and a `WeakMap` lets the entry go when the request does. This is the TanStack
 * half of the Next package's `cache()` — there is no RSC here, so React's
 * request memoisation does not exist (see the note at the top of this file).
 *
 * Outside a request there is nothing to scope to and `getRequest` throws;
 * `null` then means "compute every time", which is what this did before the
 * memo existed. See `memoizePerRequest`.
 *
 * Built PER `initValContent` rather than once for the module, because the box
 * is only as specific as the map it came from: two Val servers in one process
 * sharing one would answer each other's reads within a request, and they hold
 * different content.
 */
export function createTanStackRequestScope(): GetDraftSourcesScope {
  const boxes = new WeakMap<Request, RequestScopedMemo<DraftSources | null>>();
  return async () => {
    let request: Request;
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      request = getRequest();
    } catch {
      // Not inside a request -- nothing request-scoped to hang the memo on.
      return null;
    }
    const existing = boxes.get(request);
    if (existing) {
      return existing;
    }
    const box: RequestScopedMemo<DraftSources | null> = {};
    boxes.set(request, box);
    return box;
  };
}

/** What a misuse of a reader is told, beside what went wrong. */
const WHERE =
  "fetchVal can only be used server-side (in a loader, a server function, or a server route). Use useVal in components.";

/**
 * What a read in this request reads, in order: the draft (in draft mode),
 * then the snapshot, then -- added by every read -- the bundle. Edit tags
 * are decided here, once, from draft mode.
 */
function requestEnv(
  enabled: boolean,
  draft: ContentSource | null,
  snapshot: Snapshot | undefined,
): ReadEnv {
  if (enabled) {
    SET_AUTO_TAG_JSX_ENABLED(true);
  }
  return {
    sources:
      draft === null
        ? [snapshotSource(snapshot)]
        : [draft, snapshotSource(snapshot)],
    encode: enabled,
    schemaVersionOf: readerSchemaVersion,
  };
}

/** What a reader needs from the app and the request. */
type ReaderDeps = {
  valServer: Promise<DraftValServer>;
  isEnabled: () => Promise<boolean>;
  getHeaders: () => Promise<{ get(name: string): string | null }>;
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>;
  scope: GetDraftSourcesScope;
  /** A proposal's saved Source; see `ValDraft.snapshot`. */
  snapshot: Snapshot | undefined;
};

/** `fetchVal`, with what it read: see `readsOfFetchVal`. */
function fetchValWithReads(deps: ReaderDeps) {
  return async <T extends Resolvable>(
    selector: T,
    opts?: { entries?: boolean },
  ): Promise<Ready<ResolvedVal<T>>> => {
    const { enabled, draft } = await draftForRequest({
      valServer: deps.valServer,
      isEnabled: deps.isEnabled,
      getCookies: deps.getCookies,
      modules: {
        valServer: deps.valServer,
        getHeaders: deps.getHeaders,
        scope: deps.scope,
      },
      where: WHERE,
    });
    const env = requestEnv(enabled, draft, deps.snapshot);
    return awaitResolved((settled) =>
      resolveVal(selector, env, { settled, ...opts }),
    );
  };
}

export const initFetchValStega = (
  config: ValConfig,
  valApiEndpoints: string,
  valServerPromise: Promise<DraftSourcesValServer>,
  isEnabled: () => Promise<boolean>,
  getHeaders: () => Promise<{
    get(name: string): string | null;
  }>,
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>,
  getDraftSourcesScope: GetDraftSourcesScope,
  /** A proposal's saved Source; see `ValDraft.snapshot`. */
  snapshot?: Snapshot,
) =>
  fetchValFrom(
    fetchValWithReads({
      valServer: valServerPromise,
      isEnabled,
      getHeaders,
      getCookies,
      scope: getDraftSourcesScope,
      snapshot,
    }),
  );

/** A proposal's saved Source, by module: see `ValProposal` in `@valbuild/server`. */
type Snapshot = Record<ModuleFilePath, Json>;

/**
 * What the readers render over the bundle: a proposal's saves over the
 * content version the site serves (`layeredSnapshot` in @valbuild/server),
 * either alone, or nothing.
 */
export function snapshotForReaders(
  http:
    | Pick<ValHttpMode, "proposal" | "contentVersion" | "projectSource">
    | undefined,
): Snapshot | undefined {
  const source = layeredSnapshot(http?.proposal, http?.contentVersion);
  return source !== undefined
    ? proposalSnapshotForReaders(source, http?.projectSource)
    : undefined;
}

/**
 * What the server's own draft starts from, where it is not the bundle's: the
 * layers `ValOpsHttp` puts over it (`siteSnapshotSources`, then
 * `snapshotSources`), in the same form, so the Studio that starts from it
 * holds the base the server reports. See `ValDraft.base`.
 */
export function draftBase(
  http: Pick<ValHttpMode, "proposal" | "contentVersion"> | undefined,
): Snapshot | undefined {
  const layered = layeredSnapshot(http?.proposal, http?.contentVersion);
  return layered !== undefined ? proposalSnapshot(layered) : undefined;
}

/**
 * Where an isolate says which content version it applied, for the platform
 * serving it to read back after a render (valbuild/home: the loader answers it
 * as a header). A Val that predates content versions never sets it, which is
 * how the platform tells that an app cannot be served a version its build does
 * not bundle -- an unknown option is otherwise ignored, silently.
 */
export const CONTENT_APPLIED_GLOBAL = "__VAL_CONTENT_APPLIED";

/**
 * Name the content version this isolate renders, when it renders one -- at a
 * proposal's address too, where it is under the proposal's saves.
 */
export function markContentApplied(
  http: Pick<ValHttpMode, "proposal" | "contentVersion"> | undefined,
): void {
  if (http?.contentVersion === undefined) {
    return;
  }
  Reflect.set(globalThis, CONTENT_APPLIED_GLOBAL, http.contentVersion.id);
}

/** What the hooks' server render reads the draft from: see `fetchValDraft`. */
const draftReadsOf = new WeakMap<
  object,
  () => Promise<Ready<ValDraft | null>>
>();

/**
 * The read behind a `fetchValDraft`, with which modules it read and the
 * version of each: what the scenario world (`scenarios/`) records beside the
 * page it renders. Nothing in the product asks.
 */
export function readsOfFetchValDraft(
  fetchValDraft: object,
): (() => Promise<Ready<ValDraft | null>>) | null {
  return draftReadsOf.get(fetchValDraft) ?? null;
}

/**
 * The draft a page in this request should start from, or `null` for none.
 *
 * `null` -- and no read at all -- unless draft mode is on: a visitor pays one
 * cookie lookup. Otherwise the SAME read every `fetchVal` in the request
 * shares (`draftTree`, memoised per request), cut down to the modules the
 * draft changes. See `ValDraft`. The read is `readDraftChanges` in
 * `@valbuild/server`, which `@valbuild/next/rsc`'s `fetchValDraft` is too;
 * this adds a proposal's snapshot and the draft's base, which Next has not.
 *
 * Exists because the hooks render on the server too, and had no draft there:
 * a draft page was rendered as the published site and only then replaced, in
 * the browser, by what the editor holds -- old text first on every load.
 */
export const initFetchValDraft = (
  valServerPromise: Promise<DraftValServer>,
  isEnabled: () => Promise<boolean>,
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>,
  getDraftSourcesScope: GetDraftSourcesScope,
  /** A proposal's saved Source; see `ValDraft.snapshot`. */
  snapshot?: Snapshot,
  /** What the server's draft starts from; see `ValDraft.base`. */
  base?: Snapshot,
  /** Whether this serves a proposal's address; see `ValDraft.atProposal`. */
  atProposal: boolean = false,
) => {
  const withReads = async (): Promise<Ready<ValDraft | null>> => {
    const proposal: Pick<ValDraft, "atProposal"> = atProposal
      ? { atProposal: true }
      : {};
    const changes = await readDraftChanges({
      valServer: valServerPromise,
      isEnabled,
      getCookies,
      scope: getDraftSourcesScope,
    });
    if (changes === null) {
      // At a proposal's address the page needs the snapshot whatever draft
      // mode says, so a reviewer who is not editing sees the proposal too.
      // So does a content version, which is the live site's content.
      return {
        value:
          snapshot !== undefined
            ? { sources: {}, snapshot, draftMode: false, ...proposal }
            : null,
        reads: [],
      };
    }
    return {
      value: {
        sources: changes.sources,
        ...(snapshot !== undefined ? { snapshot } : {}),
        ...(base !== undefined ? { base } : {}),
        ...proposal,
      },
      reads: changes.reads,
    };
  };
  const fetchValDraft = async (): Promise<ValDraft | null> =>
    (await withReads()).value;
  draftReadsOf.set(fetchValDraft, withReads);
  return fetchValDraft;
};

const initFetchValRouteStega = (
  config: ValConfig,
  valApiEndpoints: string,
  valServerPromise: Promise<RouteReaderValServer>,
  isEnabled: () => Promise<boolean>,
  getHeaders: () => Promise<{
    get(name: string): string | null;
  }>,
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>,
  getDraftSourcesScope: GetDraftSourcesScope,
  /** A proposal's saved Source; see `ValDraft.snapshot`. */
  snapshot?: Snapshot,
) => {
  const fetchVal = fetchValWithReads({
    valServer: valServerPromise,
    isEnabled,
    getHeaders,
    getCookies,
    scope: getDraftSourcesScope,
    snapshot,
  });
  const fetchValKey = initFetchValKeyStega(
    valServerPromise,
    isEnabled,
    getCookies,
    snapshot,
  );
  return async <T extends ResolvableModule>(
    selector: T,
    params:
      | Promise<Record<string, string | string[]>>
      | Record<string, string | string[]>
      | unknown,
  ): Promise<RouteValueOf<T>> => {
    const resolvedParams = await Promise.resolve(params);
    // A view is a pointer: everything below reads a path, a schema and a source
    // off this, and a pointer has none of them. See `resolveViewedModule`.
    const valModule = Internal.resolveViewedModule<SourceObject>(selector);
    const path = valModule && Internal.getValPath(valModule);
    const schema = valModule && Internal.getSchema(valModule);
    // `.jsonValues()` router: map params → the entry key and load ONLY that
    // entry, instead of the whole record.
    if (isJsonValuesRecordSchema(schema)) {
      const url = getValRouteUrlFromVal(
        resolvedParams,
        "fetchValRoute",
        path,
        schema,
        valModule && Internal.getSource(valModule),
      );
      if (!url) {
        return null as RouteValueOf<T>;
      }
      const content = await fetchValKey(valModule, url);
      return (content === undefined ? null : content) as RouteValueOf<T>;
    }
    const val = valModule && (await fetchVal(valModule)).value;
    return initValRouteFromVal(
      resolvedParams,
      "fetchValRoute",
      path,
      schema,
      val,
    );
  };
};

/**
 * Resolves ONE `.jsonValues()` entry by key, loading only that entry instead of
 * the whole record — the runtime-scaling counterpart to the eager `fetchVal`.
 *
 * Production (Val disabled): the entry's lazy import from the bundle (one
 * dynamic import, no server round-trip), unless a proposal's snapshot has it.
 *
 * Draft mode: the entry through `/json`, which replays pending patches, so
 * uncommitted Studio edits show up; an entry the draft deleted is not there.
 */
export const initFetchValKeyStega =
  (
    valServerPromise: Promise<JsonEntryValServer>,
    isEnabled: () => Promise<boolean>,
    getCookies: () => Promise<{
      get(name: string): { name: string; value: string } | undefined;
    }>,
    /** A proposal's saved Source; see `ValDraft.snapshot`. */
    snapshot?: Snapshot,
  ) =>
  async <T extends ResolvableModule>(
    selector: T,
    key: string,
  ): Promise<JsonEntryContentOf<T> | undefined> => {
    const { enabled, draft } = await draftForRequest({
      valServer: valServerPromise,
      isEnabled,
      getCookies,
    });
    const env = requestEnv(enabled, draft, snapshot);
    return (
      await awaitResolved((settled) =>
        resolveValEntry(selector, key, env, { settled }),
      )
    ).value;
  };

const initFetchValRouteUrl = (
  config: ValConfig,
  valApiEndpoints: string,
  valServerPromise: Promise<RouteReaderValServer>,
  isEnabled: () => Promise<boolean>,
  getHeaders: () => Promise<{
    get(name: string): string | null;
  }>,
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>,
  getDraftSourcesScope: GetDraftSourcesScope,
  /** A proposal's saved Source; see `ValDraft.snapshot`. */
  snapshot?: Snapshot,
) => {
  const fetchVal = fetchValWithReads({
    valServer: valServerPromise,
    isEnabled,
    getHeaders,
    getCookies,
    scope: getDraftSourcesScope,
    snapshot,
  });
  return async <T extends ResolvableModule>(
    selector: T,
    params?:
      | Promise<Record<string, string | string[]>>
      | Record<string, string | string[]>
      | unknown,
  ): Promise<string | null> => {
    const resolvedParams =
      params === undefined ? undefined : await Promise.resolve(params);
    // A view is a pointer: everything below reads a path, a schema and a source
    // off this, and a pointer has none of them. See `resolveViewedModule`.
    const valModule = Internal.resolveViewedModule<SourceObject>(selector);
    // The url is made of the params and the module's path: a `.jsonValues()`
    // router's entries are not imported for it.
    const val =
      valModule && (await fetchVal(valModule, { entries: false })).value;
    return getValRouteUrlFromVal(
      resolvedParams,
      "fetchValRouteUrl",
      valModule && Internal.getValPath(valModule),
      valModule && Internal.getSchema(valModule),
      val,
    );
  };
};

const valApiEndpoints = "/api/val";

/**
 * The request's headers, as the readers above want them.
 *
 * TanStack resolves the current request out of async local storage, so there
 * is nothing to pass in — and nothing to read outside a request, which is what
 * the throw is: the callers catch it and fall back to published content.
 */
async function requestHeaders(): Promise<{
  get(name: string): string | null;
}> {
  const { getRequestHeaders } = await import("@tanstack/react-start/server");
  const headers = getRequestHeaders();
  return {
    get(name: string) {
      return headers.get(name) ?? null;
    },
  };
}

/** The request's cookies, in the `{ name, value }` shape the readers want. */
async function requestCookies(): Promise<{
  get(name: string): { name: string; value: string } | undefined;
}> {
  const { getCookie } = await import("@tanstack/react-start/server");
  return {
    get(name: string) {
      const value = getCookie(name);
      return value === undefined ? undefined : { name, value };
    },
  };
}

/**
 * Val's content readers for the server side of a TanStack Start app.
 *
 * Use them where the server runs: a route `loader` during SSR, a
 * `createServerFn`, or a server route handler. In the browser — a client
 * navigation re-running a loader, say — there is no request to read draft
 * state from, so they resolve the published content, which is the same answer
 * the visitor would get.
 *
 * @example
 * // src/val/server.ts
 * import { initValContent } from "@valbuild/tanstack/server";
 * import { config } from "../val.config";
 * import valModules from "../val.modules";
 *
 * export const {
 *   fetchValStega: fetchVal,
 *   fetchValRouteStega: fetchValRoute,
 * } = initValContent(config, valModules);
 */
export function initValContent(
  config: ValConfig,
  valModules: ValModules,
  opts?: {
    /**
     * How preview mode is stored for a browser.
     *
     * Defaults to Val's own cookie. Pass the SAME object `initValServer` got:
     * the API turns preview on and these readers are what has to notice.
     */
    draftMode?: ValDraftMode;
    /**
     * The project's source, for a host that holds it rather than having it on
     * a disk. Pass the SAME record `initValServer` got.
     *
     * These readers have a Val server of their own -- they resolve content by
     * asking it, not by calling the API over HTTP -- so the mode question is
     * put to them separately, and answering it only for `initValServer` left
     * the readers inferring `fs` mode. On a host with no filesystem that is
     * a reader looking for a working tree that is not there.
     */
    sourceFiles?: Record<string, string>;
    /**
     * Where pending patches live, with {@link sourceFiles}. Pass the SAME
     * store `initValServer` got.
     *
     * Two stores are two sets of pending edits: the API would write a patch
     * into one and a draft render would read the other and show none of it.
     * Left out, this reader gets its own, which is correct for published
     * content and empty for drafts.
     */
    patchStore?: ValPatchStore;
    /**
     * Serve memory mode without authenticating. Pass the SAME value
     * `initValServer` got.
     *
     * This reader's server checks a session like the API's does, so a host
     * that authenticates outside Val -- and therefore sends no Val session
     * cookie -- gets 401 from its own reader and silently falls back to
     * PUBLISHED content. A draft render that shows the live site is the
     * hardest kind of wrong to notice.
     */
    unsafelyAllowUnauthenticated?: boolean;
    /**
     * Put these readers in `http` mode. Pass the SAME object `initValServer`
     * got.
     *
     * Separate for the same reason {@link sourceFiles} is: these readers have
     * a Val server of their own, so the mode question is put to them
     * independently. Answering it only for `initValServer` leaves them
     * inferring -- and on a host that hands Val its credentials in code rather
     * than through the environment, there is nothing to infer FROM, since
     * `process.env.VAL_API_KEY` is undefined in a bundle built separately from
     * its dependencies.
     *
     * `git`, where the project has a repository, is what makes this more than
     * bookkeeping: it decides which commit the `.val.ts` mirror is produced
     * against, so these readers and the API have to be given the same one or a
     * publish patches a different version of the file than the site is
     * running. A project with no repository passes no `git` at all, and there
     * is nothing here that can then disagree.
     */
    http?: ValHttpMode;
  },
): {
  fetchValStega: ReturnType<typeof initFetchValStega>;
  fetchValKeyStega: ReturnType<typeof initFetchValKeyStega>;
  fetchValRouteStega: ReturnType<typeof initFetchValRouteStega>;
  fetchValRouteUrl: ReturnType<typeof initFetchValRouteUrl>;
  /**
   * The draft for `<ValProvider draft>`, or `null`. Call it from a server
   * function in the site layout's loader -- see `ValDraft`.
   */
  fetchValDraft: ReturnType<typeof initFetchValDraft>;
} {
  const coreVersion = Internal.VERSION.core;
  if (!coreVersion) {
    throw new Error("Could not get @valbuild/core package version");
  }
  const tanstackVersion = VERSION;
  if (!tanstackVersion) {
    throw new Error("Could not get @valbuild/tanstack package version");
  }
  const draftSourcesScope = createTanStackRequestScope();
  const snapshot = snapshotForReaders(opts?.http);
  const base = draftBase(opts?.http);
  markContentApplied(opts?.http);
  const draftMode = opts?.draftMode ?? valDraftMode();
  const isEnabled = () => draftMode.isEnabled();

  const valServerPromise = createValServer(
    valModules,
    valApiEndpoints,
    {
      versions: {
        // `next` is the field name in the wire contract; see initValServer.
        next: tanstackVersion,
        core: coreVersion,
        framework: "tanstack",
      },
      ...config,
      // Present only when the host supplied them: `sourceFiles` is what
      // selects memory mode, so a key set to `undefined` would be a different
      // thing from an absent one.
      ...(opts?.sourceFiles !== undefined
        ? { sourceFiles: opts.sourceFiles }
        : {}),
      ...(opts?.patchStore !== undefined
        ? { patchStore: opts.patchStore }
        : {}),
      ...(opts?.unsafelyAllowUnauthenticated !== undefined
        ? { unsafelyAllowUnauthenticated: opts.unsafelyAllowUnauthenticated }
        : {}),
      ...(opts?.http !== undefined ? opts.http : {}),
    },
    config,
    {
      isEnabled,
      onEnable() {
        return draftMode.enable();
      },
      onDisable() {
        return draftMode.disable();
      },
    },
  );
  return {
    fetchValStega: initFetchValStega(
      config,
      valApiEndpoints, // TODO: get from config
      valServerPromise,
      isEnabled,
      requestHeaders,
      requestCookies,
      draftSourcesScope,
      snapshot,
    ),
    fetchValKeyStega: initFetchValKeyStega(
      valServerPromise,
      isEnabled,
      requestCookies,
      snapshot,
    ),
    fetchValRouteStega: initFetchValRouteStega(
      config,
      valApiEndpoints,
      valServerPromise,
      isEnabled,
      requestHeaders,
      requestCookies,
      draftSourcesScope,
      snapshot,
    ),
    fetchValRouteUrl: initFetchValRouteUrl(
      config,
      valApiEndpoints,
      valServerPromise,
      isEnabled,
      requestHeaders,
      requestCookies,
      draftSourcesScope,
      snapshot,
    ),
    fetchValDraft: initFetchValDraft(
      valServerPromise,
      isEnabled,
      requestCookies,
      draftSourcesScope,
      snapshot,
      base,
      opts?.http?.proposal !== undefined,
    ),
  };
}
