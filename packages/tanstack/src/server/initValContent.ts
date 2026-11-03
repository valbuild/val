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
import { type ContentSource } from "@valbuild/shared/internal";
import {
  createValRuntime,
  draftForRequest,
  layeredSnapshot,
  proposalSnapshot,
  proposalSnapshotForReaders,
  proposalAsBuilt,
  readDraftChanges,
  readerSchemaVersion,
  type ValPatchStore,
  type ValRuntime,
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

/**
 * What the readers read: this process's runtime for the app's `val.modules`
 * (`createValRuntime`), the same one `initValServer`'s server is built on.
 * Its head is the draft, read with the request's session.
 */
export type ReaderRuntime = Promise<ValRuntime>;

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
export type ReaderDeps = {
  runtime: ReaderRuntime;
  isEnabled: () => Promise<boolean>;
  getHeaders: () => Promise<{ get(name: string): string | null }>;
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>;
  /** A proposal's saved Source; see `ValDraft.snapshot`. */
  snapshot?: Snapshot;
};

/** `fetchVal`, with what it read: see `readsOfFetchVal`. */
function fetchValWithReads(deps: ReaderDeps) {
  return async <T extends Resolvable>(
    selector: T,
    opts?: { entries?: boolean },
  ): Promise<Ready<ResolvedVal<T>>> => {
    const { enabled, draft } = await draftForRequest({
      runtime: deps.runtime,
      isEnabled: deps.isEnabled,
      getCookies: deps.getCookies,
      modules: { getHeaders: deps.getHeaders },
      where: WHERE,
    });
    const env = requestEnv(enabled, draft, deps.snapshot);
    return awaitResolved((settled) =>
      resolveVal(selector, env, { settled, ...opts }),
    );
  };
}

export const initFetchValStega = (deps: ReaderDeps) =>
  fetchValFrom(fetchValWithReads(deps));

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
  const source = layeredSnapshot(
    // Not a module staged after the build serving the address: its Source
    // fits code these readers have not got. See `proposalAsBuilt`.
    http?.proposal !== undefined ? proposalAsBuilt(http.proposal) : undefined,
    http?.contentVersion,
  );
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

/** The runtime behind a reader: see {@link runtimeOfReaders}. */
const runtimesOf = new WeakMap<object, ReaderRuntime>();

/**
 * The runtime a set of readers reads through, by its `fetchValStega`: what
 * the scenario world (`scenarios/`) asks the head's size of. Nothing in the
 * product asks.
 */
export function runtimeOfReaders(fetchValStega: object): ReaderRuntime | null {
  return runtimesOf.get(fetchValStega) ?? null;
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
 * cookie lookup. Otherwise the runtime's head, which every `fetchVal` reads,
 * cut down to the modules the draft changes, with the version of each. See
 * `ValDraft`. The read is `readDraftChanges` in
 * `@valbuild/server`, which `@valbuild/next/rsc`'s `fetchValDraft` is too;
 * this adds a proposal's snapshot and the draft's base, which Next has not.
 *
 * Exists because the hooks render on the server too, and had no draft there:
 * a draft page was rendered as the published site and only then replaced, in
 * the browser, by what the editor holds -- old text first on every load.
 */
export const initFetchValDraft = (
  deps: Omit<ReaderDeps, "getHeaders"> & {
    /** What the server's draft starts from; see `ValDraft.base`. */
    base?: Snapshot;
    /** Whether this serves a proposal's address; see `ValDraft.atProposal`. */
    atProposal?: boolean;
  },
) => {
  const { snapshot, base } = deps;
  const withReads = async (): Promise<Ready<ValDraft | null>> => {
    const proposal: Pick<ValDraft, "atProposal"> =
      deps.atProposal === true ? { atProposal: true } : {};
    const changes = await readDraftChanges(deps);
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
        versions: changes.versions,
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

const initFetchValRouteStega = (deps: ReaderDeps) => {
  const fetchVal = fetchValWithReads(deps);
  const fetchValKey = initFetchValKeyStega(deps);
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
 * Draft mode: the entry from the runtime's head, with the pending patches the
 * draft holds for it, so uncommitted Studio edits show up; an entry the draft
 * deleted is not there. An entry of a record no patch touched is the bundle's
 * (or the snapshot's).
 */
export const initFetchValKeyStega =
  (deps: Omit<ReaderDeps, "getHeaders">) =>
  async <T extends ResolvableModule>(
    selector: T,
    key: string,
  ): Promise<JsonEntryContentOf<T> | undefined> => {
    const { enabled, draft } = await draftForRequest({
      runtime: deps.runtime,
      isEnabled: deps.isEnabled,
      getCookies: deps.getCookies,
    });
    const env = requestEnv(enabled, draft, deps.snapshot);
    return (
      await awaitResolved((settled) =>
        resolveValEntry(selector, key, env, { settled }),
      )
    ).value;
  };

const initFetchValRouteUrl = (deps: ReaderDeps) => {
  const fetchVal = fetchValWithReads(deps);
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
  const snapshot = snapshotForReaders(opts?.http);
  const base = draftBase(opts?.http);
  markContentApplied(opts?.http);
  const draftMode = opts?.draftMode ?? valDraftMode();
  const isEnabled = () => draftMode.isEnabled();

  // One runtime per process for these modules: `initValServer`'s server is
  // built on the same one when it is given the same options, so a save
  // through the API moves what these read.
  const runtime = createValRuntime(
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
  );
  const deps: ReaderDeps = {
    runtime,
    isEnabled,
    getHeaders: requestHeaders,
    getCookies: requestCookies,
    ...(snapshot !== undefined ? { snapshot } : {}),
  };
  const fetchValStega = initFetchValStega(deps);
  runtimesOf.set(fetchValStega, runtime);
  return {
    fetchValStega,
    fetchValKeyStega: initFetchValKeyStega(deps),
    fetchValRouteStega: initFetchValRouteStega(deps),
    fetchValRouteUrl: initFetchValRouteUrl(deps),
    fetchValDraft: initFetchValDraft({
      ...deps,
      ...(base !== undefined ? { base } : {}),
      atProposal: opts?.http?.proposal !== undefined,
    }),
  };
}
