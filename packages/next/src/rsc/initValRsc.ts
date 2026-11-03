import {
  type JsonEntryContentOf,
  type Ready,
  type ReadEnv,
  type Resolvable,
  type ResolvedVal,
  type RouteValueOf,
  SET_AUTO_TAG_JSX_ENABLED,
  SET_RSC,
  awaitResolved,
  fetchValFrom,
  isJsonValuesRecordSchema,
  resolveVal,
  resolveValEntry,
  type ValDraft,
} from "@valbuild/react/stega";
import {
  ValConfig,
  ValModules,
  Internal,
  type ResolvableModule,
  SourceObject,
} from "@valbuild/core";
import { cookies, draftMode, headers } from "next/headers";
import { type ContentSource } from "@valbuild/shared/internal";
import {
  createValRuntime,
  draftForRequest,
  readDraftChanges,
  readerSchemaVersion,
  type ValRuntime,
} from "@valbuild/server";
import { VERSION } from "../version";
import { getValRouteUrlFromVal, initValRouteFromVal } from "../routeFromVal";

SET_RSC(true);

/*
 * The readers below are `resolveVal` (`@valbuild/react/stega`) over this
 * request's sources: the draft (`serverDraftSource`, in `@valbuild/server`),
 * then the bundle. Only the sources are Next's; the rule that picks between
 * them is the same in `@valbuild/tanstack` and in the hooks. See
 * `docs/plans/one-content-model.md`, "One way to load".
 */

/**
 * What the readers read: this process's runtime for the app's `val.modules`
 * (`createValRuntime`), the same one the API route's server is built on.
 * Its head is the draft, read with the request's session.
 */
export type ReaderRuntime = Promise<ValRuntime>;

/** What a misuse of a reader is told, beside what went wrong. */
const WHERE = "fetchVal can only be used server-side. Use useVal on clients.";

/**
 * What a read in this request reads, in order: the draft (in draft mode),
 * then -- added by every read -- the bundle. Edit tags are decided here,
 * once, from draft mode.
 */
function requestEnv(enabled: boolean, draft: ContentSource | null): ReadEnv {
  if (enabled) {
    SET_AUTO_TAG_JSX_ENABLED(true);
  }
  return {
    sources: draft === null ? [] : [draft],
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
    const env = requestEnv(enabled, draft);
    return awaitResolved((settled) =>
      resolveVal(selector, env, { settled, ...opts }),
    );
  };
}

export const initFetchValStega = (deps: ReaderDeps) =>
  fetchValFrom(fetchValWithReads(deps));

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
 * Production (Val disabled): the entry's lazy import from the bundle. One
 * dynamic import, no server round-trip.
 *
 * Draft mode: the entry from the runtime's head, with the pending patches the
 * draft holds for it, so uncommitted Studio edits show up; an entry the draft
 * deleted is not there. An entry of a record no patch touched is the bundle's.
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
    const env = requestEnv(enabled, draft);
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

/**
 * The draft a page in this request should start from, or `null` for none:
 * what `<ValProvider draft>` takes. See `ValDraft`.
 *
 * `null` -- and no read at all -- unless the request is in draft mode: a
 * visitor pays one `draftMode()` lookup, which does not make a static route
 * dynamic. In draft mode it is the source of every module the editor's draft
 * changes, from the runtime's head -- the one every `fetchVal` reads -- so
 * the server renders the draft and the browser hydrates the same thing, with
 * the version of each, so the page compares versions with what the Studio
 * relays rather than content. Also `null` when the session is not one Val
 * accepts, or the draft could not be read (logged): the published page.
 *
 * The read is `readDraftChanges` in `@valbuild/server`, which
 * `@valbuild/tanstack/server`'s `fetchValDraft` is too; only where draft mode
 * and the cookies come from is Next's.
 */
export const initFetchValDraft =
  (deps: Omit<ReaderDeps, "getHeaders">) =>
  async (): Promise<ValDraft | null> => {
    const changes = await readDraftChanges(deps);
    return changes === null
      ? null
      : { sources: changes.sources, versions: changes.versions };
  };

type ValNextRscConfig = {
  draftMode: typeof draftMode;
  headers: typeof headers;
  cookies: typeof cookies;
};

export function initValRsc(
  config: ValConfig,
  valModules: ValModules,
  rscNextConfig: ValNextRscConfig,
): {
  fetchValStega: ReturnType<typeof initFetchValStega>;
  fetchValKeyStega: ReturnType<typeof initFetchValKeyStega>;
  fetchValRouteStega: ReturnType<typeof initFetchValRouteStega>;
  fetchValRouteUrl: ReturnType<typeof initFetchValRouteUrl>;
  /**
   * The draft for `<ValProvider draft>`, or `null` outside draft mode. Call
   * it in the root layout (a Server Component) and pass what it returns:
   *
   * ```tsx
   * <ValProvider config={config} draft={await fetchValDraft()}>
   * ```
   *
   * See "The `draft` prop" in the README, and `ValDraft`.
   */
  fetchValDraft: ReturnType<typeof initFetchValDraft>;
} {
  const coreVersion = Internal.VERSION.core;
  if (!coreVersion) {
    throw new Error("Could not get @valbuild/core package version");
  }
  const nextVersion = VERSION;
  if (!nextVersion) {
    throw new Error("Could not get @valbuild/next package version");
  }
  // One runtime per process for these modules: the API route's server is
  // built on the same one, so a save through it moves what these read.
  const runtime = createValRuntime(
    valModules,
    "/api/val",
    {
      versions: {
        next: nextVersion,
        core: coreVersion,
        framework: "next",
      },
      ...config,
    },
    config,
  );
  const deps: ReaderDeps = {
    runtime,
    isEnabled: async () => (await rscNextConfig.draftMode()).isEnabled,
    getHeaders: async () => await rscNextConfig.headers(),
    getCookies: async () => await rscNextConfig.cookies(),
  };
  return {
    fetchValStega: initFetchValStega(deps),
    fetchValKeyStega: initFetchValKeyStega(deps),
    fetchValRouteStega: initFetchValRouteStega(deps),
    fetchValRouteUrl: initFetchValRouteUrl(deps),
    fetchValDraft: initFetchValDraft(deps),
  };
}
