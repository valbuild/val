import {
  SET_AUTO_TAG_JSX_ENABLED,
  SET_RSC,
  stegaEncode,
  type StegaOfSource,
} from "@valbuild/react/stega";
import {
  SelectorSource,
  SelectorOf,
  GenericSelector,
  ModuleFilePath,
  ValConfig,
  ValModules,
  Internal,
  ValModule,
  SourceObject,
  JsonSource,
  type ExternalRecordSrc,
} from "@valbuild/core";
import { cookies, draftMode, headers } from "next/headers";
import { VAL_SESSION_COOKIE } from "@valbuild/shared/internal";
import {
  createValServer,
  VAL_OPS,
  ValServer,
  type ExternalRecords,
  type ItemOfModule,
} from "@valbuild/server";
import { VERSION } from "../version";
import {
  initFetchValAll,
  initFetchValEntries,
  initFetchValKey,
  initFetchValKeys,
  isExternalValModule,
  type ExternalModule,
} from "./externalRsc";
import {
  getJsonEntryStegaRoot,
  getValRouteUrlFromVal,
  initValRouteFromVal,
  isJsonValuesRecordSchema,
} from "../routeFromVal";

SET_RSC(true);
const initFetchValStega =
  (
    config: ValConfig,
    valApiEndpoints: string,
    valServerPromise: Promise<ValServer>,
    isEnabled: () => Promise<boolean>,
    getHeaders: () => Promise<{
      get(name: string): string | null;
    }>,
    getCookies: () => Promise<{
      get(name: string): { name: string; value: string } | undefined;
    }>,
  ) =>
  <T extends SelectorSource>(
    selector: T,
  ): Promise<
    SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never
  > => {
    const exec = async (): Promise<
      SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never
    > => {
      // An external record has nothing to read locally: its entries are in the
      // store, so `fetchVal` pages them out rather than resolving a source that
      // holds only a marker. Slow on a big store and offered anyway — an editor
      // who wants every entry is allowed to ask for every entry — and it fails
      // on a TIMEOUT rather than a size, because "too big" is not something Val
      // can judge.
      if (isExternalValModule(selector)) {
        // Built here rather than passed in, so `fetchVal` stays ONE function:
        // which storage mode a module uses must not change which reader an app
        // calls, and every caller of this already has what the reader needs.
        const fetchExternalAll = initFetchValAll({
          valServerPromise,
          isEnabled,
        });
        // The one assertion here: `StegaOfSource<ExternalRecordSrc<Item>>` IS
        // `Record<string, StegaOfSource<Item>>` by the definition in
        // `stegaEncode.ts`, but proving that inside a function generic over
        // every SelectorSource is not something the compiler can be walked
        // through.
        const entries: unknown = await fetchExternalAll(selector);
        return entries as SelectorOf<T> extends GenericSelector<infer S>
          ? StegaOfSource<S>
          : never;
      }
      let enabled = false;
      try {
        enabled = await isEnabled();
      } catch (err) {
        console.error(
          "Val: could not check if Val is enabled! This might be due to an error to check draftMode. fetchVal can only be used server-side. Use useVal on clients.",
          err,
        );
      }
      if (enabled) {
        SET_AUTO_TAG_JSX_ENABLED(true);
        let headers;
        try {
          headers = await getHeaders();
          if (typeof headers.get !== "function") {
            throw new Error("Invalid headers");
          }
        } catch (err) {
          console.error(
            "Val: could not read headers! fetchVal can only be used server-side. Use useVal on clients.",
            err,
          );
          headers = null;
        }

        let cookies: {
          get(name: string): { name: string; value: string } | undefined;
        } | null;
        try {
          cookies = await getCookies();
        } catch (err) {
          console.error(
            "Val: could not read cookies! fetchVal can only be used server-side. Use useVal on clients.",
            err,
          );
          cookies = null;
        }

        const host: string | null = headers && getHost(headers);
        if (host && cookies) {
          const valServer = await valServerPromise;
          const treeRes = await valServer["/sources/~"]["PUT"]({
            path: "/",
            query: {
              validate_sources: true,
              validate_binary_files: false,
              exclude_patches: false,
              // RSC pre-render uses the legacy "server applies patches" path.
              apply_patches: undefined,
            },
            cookies: {
              [VAL_SESSION_COOKIE]: cookies?.get(VAL_SESSION_COOKIE)?.value,
            },
          });

          if (treeRes.status === 200) {
            const { modules } = treeRes.json;
            return stegaEncode(selector, {
              disabled: !enabled,
              getModule: (path) => {
                const module = modules[path as ModuleFilePath];
                if (module) {
                  return module.source;
                }
              },
            });
          } else {
            if (treeRes.status === 401) {
              console.warn("Val: authentication error: ", treeRes.json.message);
            } else {
              throw Error(JSON.stringify(treeRes.json, null, 2));
            }
          }
        }
      }
      return stegaEncode(selector, {
        disabled: !enabled,
      });
    };
    return exec().catch((err) => {
      console.error("Val: failed to fetch ", err);
      return stegaEncode(selector, {});
    });
  };

function getHost(headers: { get(name: string): string | null } | undefined) {
  // TODO: does NextJs have a way to determine this?
  const host = headers?.get("host");
  let proto = "https";
  if (headers?.get("x-forwarded-proto") === "http") {
    proto = "http";
  } else if (headers?.get("referer")?.startsWith("http://")) {
    proto = "http";
  } else if (host?.startsWith("localhost")) {
    proto = "http";
  }
  if (host && proto) {
    return `${proto}://${host}`;
  }
  return null;
}

// TODO: remove
// function getValAuthHeaders(cookies: {
//   get(name: string): { name: string; value: string } | undefined;
// }): Record<string, string> {
//   try {
//     const session = cookies.get(Internal.VAL_SESSION_COOKIE);
//     if (session) {
//       return {
//         Cookie: `${Internal.VAL_SESSION_COOKIE}=${encodeURIComponent(
//           session.value
//         )}`,
//       };
//     }
//     return {};
//   } catch (err) {
//     console.error(
//       "Val: could not read cookies! fetchVal can only be used server-side. Use useVal on clients.",
//       err
//     );
//     return {};
//   }
// }

type FetchValRouteReturnType<
  T extends ValModule<GenericSelector<SourceObject>>,
> =
  T extends ValModule<infer S>
    ? S extends SourceObject
      ? // `.jsonValues()` router: the matched entry resolves to its json content.
        NonNullable<S>[string] extends JsonSource<infer C>
        ? C | null
        : StegaOfSource<NonNullable<S>[string]> | null
      : never
    : never;

const initFetchValRouteStega =
  (
    config: ValConfig,
    valApiEndpoints: string,
    valServerPromise: Promise<ValServer>,
    isEnabled: () => Promise<boolean>,
    getHeaders: () => Promise<{
      get(name: string): string | null;
    }>,
    getCookies: () => Promise<{
      get(name: string): { name: string; value: string } | undefined;
    }>,
  ) =>
  async <T extends ValModule<GenericSelector<SourceObject>>>(
    selector: T,
    params:
      | Promise<Record<string, string | string[]>>
      | Record<string, string | string[]>
      | unknown,
  ): Promise<FetchValRouteReturnType<T>> => {
    const resolvedParams = await Promise.resolve(params);
    const path = selector && Internal.getValPath(selector);
    const schema = selector && Internal.getSchema(selector);
    // `.jsonValues()` router: map params → the entry key and load ONLY that
    // entry's backing `*.val.json`, instead of eagerly resolving the whole
    // record via `fetchVal`.
    if (isJsonValuesRecordSchema(schema)) {
      const source = selector && Internal.getSource(selector);
      const url = getValRouteUrlFromVal(
        resolvedParams,
        "fetchValRoute",
        path,
        schema,
        source,
      );
      if (!url) {
        return null as FetchValRouteReturnType<T>;
      }
      let enabled = false;
      try {
        enabled = await isEnabled();
      } catch {
        // not in a server context where draftMode is readable — treat as disabled
      }
      let draft: DraftJsonEntry = { status: "unavailable" };
      if (enabled && path) {
        SET_AUTO_TAG_JSX_ENABLED(true);
        draft = await loadDraftJsonEntry(
          valServerPromise,
          getCookies,
          path as unknown as ModuleFilePath,
          url,
        );
      }
      const content = await resolveDraftOrCommittedEntry(draft, () =>
        loadJsonEntryContent(source, url),
      );
      if (content === undefined) {
        return null as FetchValRouteReturnType<T>;
      }
      return stegaEncode(content, {
        disabled: !enabled,
        root: getJsonEntryStegaRoot(selector, url),
      });
    }
    const fetchVal = initFetchValStega(
      config,
      valApiEndpoints,
      valServerPromise,
      isEnabled,
      getHeaders,
      getCookies,
    );
    const val = selector && (await fetchVal(selector));
    const route = initValRouteFromVal(
      resolvedParams,
      "fetchValRoute",
      path,
      schema,
      val,
    );
    return route;
  };

/**
 * Resolves a single `.jsonValues()` entry's content by key from a module's local
 * source markers (one dynamic import). Returns `undefined` when the key is
 * missing or its marker has no runtime thunk (transport marker / draft entry).
 */
async function loadJsonEntryContent(
  source: unknown,
  key: string,
): Promise<unknown | undefined> {
  if (!source || typeof source !== "object") {
    return undefined;
  }
  const marker = (source as Record<string, unknown>)[key];
  if (!Internal.isJson(marker)) {
    return undefined;
  }
  const thunk = Internal.getJsonImport(marker);
  if (!thunk) {
    return undefined;
  }
  return (await thunk()).default;
}

/**
 * Loads a single `.jsonValues()` entry's DRAFT content via the in-process
 * `/json` endpoint (which replays pending patches). Returns `undefined` when the
 * entry has no draft content to serve — the caller then falls back to the
 * locally-bundled committed content.
 */
/**
 * What the draft state says about an entry.
 *
 * The three cases have to stay distinct: `absent` is an ANSWER — the entry is not
 * there in the draft state, e.g. a pending patch removed it — while `unavailable`
 * means we could not ask. Collapsing them into `undefined` is what made a
 * draft-deleted entry keep rendering its committed content: the caller could not
 * tell "it is gone" from "ask the committed source instead".
 */
/**
 * The slice of `ValServer` the single-entry readers actually use. Narrower than
 * `ValServer` on purpose: it says what the dependency IS, and it lets a test
 * drive these readers with a one-route fake instead of casting a partial object
 * to the whole server type.
 */
export type JsonEntryValServer = Pick<ValServer, "/json"> &
  // The in-process ops handle, optional so a test can still drive the jsonValues
  // readers with a one-route fake. An EXTERNAL module needs it — its content is
  // never bundled, so there is nothing else to read — and `opsOf` says so by
  // name when it is missing.
  Partial<Pick<ValServer, typeof VAL_OPS>>;

export type DraftJsonEntry =
  | { status: "content"; content: unknown }
  | { status: "absent" }
  | { status: "unavailable" };

/**
 * Picks the content a draft-aware single-entry read should render.
 *
 * The rule the two callers share: the draft state WINS when it has an answer —
 * including the answer "this entry is gone" — and the committed content is used
 * only when there is no draft answer to be had (Val disabled, or we could not
 * ask). Returning `undefined` means "render nothing"; both callers turn that into
 * a null/undefined result.
 */
export async function resolveDraftOrCommittedEntry(
  draft: DraftJsonEntry,
  loadCommitted: () => Promise<unknown | undefined>,
): Promise<unknown | undefined> {
  if (draft.status === "content") {
    return draft.content;
  }
  if (draft.status === "absent") {
    // Falling back here would render an entry the editor has just deleted.
    return undefined;
  }
  return loadCommitted();
}

async function loadDraftJsonEntry(
  valServerPromise: Promise<JsonEntryValServer>,
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>,
  moduleFilePath: ModuleFilePath,
  key: string,
): Promise<DraftJsonEntry> {
  let cookies;
  try {
    cookies = await getCookies();
  } catch {
    // not in a server context where cookies are readable
    return { status: "unavailable" };
  }
  const valServer = await valServerPromise;
  const res = await valServer["/json"]["GET"]({
    query: {
      path: moduleFilePath,
      key,
      keys: undefined, // single-entry shape
      offset: undefined,
      limit: undefined,
      apply_patches: true,
    },
    cookies: {
      [VAL_SESSION_COOKIE]: cookies?.get(VAL_SESSION_COOKIE)?.value,
    },
  });
  if (res.status === 200 && "content" in res.json) {
    return { status: "content", content: res.json.content };
  }
  if (res.status === 401) {
    console.warn("Val: authentication error: ", res.json.message);
    return { status: "unavailable" };
  }
  if (res.status === 404) {
    // Authoritative: the draft state has no such entry (removed by a pending
    // patch, or never existed). Not a reason to fall back to committed content.
    return { status: "absent" };
  }
  console.error(
    "Val: could not load draft JSON entry: ",
    "message" in res.json ? res.json.message : `status ${res.status}`,
  );
  return { status: "unavailable" };
}

/**
 * The content type one entry resolves to, whichever storage mode holds it.
 *
 * The external arm comes first because an external module IS a
 * `GenericSelector`, and the jsonValues arm would otherwise try to read a
 * `JsonSource` out of the marker's phantom slots and land on `never`.
 */
type EntryContentOf<T> =
  T extends ValModule<ExternalRecordSrc>
    ? ItemOfModule<T>
    : T extends ValModule<GenericSelector<SourceObject>>
      ? JsonEntryContentOf<T>
      : never;

// The (loosened) content type a single `.jsonValues()` entry resolves to.
type JsonEntryContentOf<T extends ValModule<GenericSelector<SourceObject>>> =
  T extends ValModule<infer S>
    ? S extends Record<string, infer V>
      ? V extends JsonSource<infer C>
        ? C
        : never
      : never
    : never;

/**
 * Resolves ONE `.jsonValues()` entry by key, loading only that entry instead of
 * the whole record — the runtime-scaling counterpart to the eager `fetchVal`.
 *
 * Production (Val disabled): resolves the entry's lazy import thunk from the
 * locally-bundled module. One dynamic import, no server round-trip.
 *
 * Enabled (draft mode): reads the entry through `/json`, which replays pending
 * patches, so uncommitted Studio edits show up. Falls back to the local thunk if
 * the draft read yields nothing.
 */
export const initFetchValKeyStega =
  (
    valServerPromise: Promise<JsonEntryValServer>,
    isEnabled: () => Promise<boolean>,
    getCookies: () => Promise<{
      get(name: string): { name: string; value: string } | undefined;
    }>,
  ) =>
  async <T extends ValModule<GenericSelector<SourceObject>> | ExternalModule>(
    selector: T,
    key: string,
  ): Promise<EntryContentOf<T> | undefined> => {
    // ONE function for both storage modes, which is the whole requirement: an
    // app reading `fetchValKey(postsVal, key)` must not have to know, or change,
    // when its content moves into a store.
    if (isExternalValModule(selector)) {
      const entry: unknown = await initFetchValKey({
        valServerPromise,
        isEnabled,
      })(selector, key);
      return entry as EntryContentOf<T> | undefined;
    }
    // Past the branch above, the module is a `.jsonValues()` one — but TypeScript
    // cannot say so: narrowing a value whose type is a TYPE PARAMETER adds to it
    // in the true branch and subtracts nothing in the false one, so `selector`
    // is still the whole union here. Naming what it now is keeps the rest of the
    // function reading as it did before external records existed.
    const jsonSelector = selector as ValModule<GenericSelector<SourceObject>>;
    let enabled = false;
    try {
      enabled = await isEnabled();
    } catch {
      // not in a server context where draftMode is readable — treat as disabled
    }
    const source = jsonSelector && Internal.getSource(jsonSelector);
    const moduleFilePath =
      jsonSelector &&
      (Internal.getValPath(jsonSelector) as unknown as ModuleFilePath);
    let draft: DraftJsonEntry = { status: "unavailable" };
    if (enabled && moduleFilePath) {
      SET_AUTO_TAG_JSX_ENABLED(true);
      draft = await loadDraftJsonEntry(
        valServerPromise,
        getCookies,
        moduleFilePath,
        key,
      );
    }
    const content = await resolveDraftOrCommittedEntry(draft, () =>
      loadJsonEntryContent(source, key),
    );
    if (content === undefined) {
      // deleted in the draft state, a missing key, or a transport marker with no
      // runtime thunk
      return undefined;
    }
    return stegaEncode(content, {
      disabled: !enabled,
      root: getJsonEntryStegaRoot(jsonSelector, key),
    });
  };

const initFetchValRouteUrl =
  (
    config: ValConfig,
    valApiEndpoints: string,
    valServerPromise: Promise<ValServer>,
    isEnabled: () => Promise<boolean>,
    getHeaders: () => Promise<{
      get(name: string): string | null;
    }>,
    getCookies: () => Promise<{
      get(name: string): { name: string; value: string } | undefined;
    }>,
  ) =>
  async <T extends ValModule<GenericSelector<SourceObject>>>(
    selector: T,
    params?:
      | Promise<Record<string, string | string[]>>
      | Record<string, string | string[]>
      | unknown,
  ): Promise<string | null> => {
    const fetchVal = initFetchValStega(
      config,
      valApiEndpoints,
      valServerPromise,
      isEnabled,
      getHeaders,
      getCookies,
    );
    const resolvedParams =
      params === undefined ? undefined : await Promise.resolve(params);
    const path = selector && Internal.getValPath(selector);
    const schema = selector && Internal.getSchema(selector);
    const val = selector && (await fetchVal(selector));
    const route = getValRouteUrlFromVal(
      resolvedParams,
      "fetchValRouteUrl",
      path,
      schema,
      val,
    );
    return route;
  };

const valApiEndpoints = "/api/val";

type ValNextRscConfig = {
  draftMode: typeof draftMode;
  headers: typeof headers;
  cookies: typeof cookies;
};

export function initValRsc(
  config: ValConfig & {
    /**
     * The project's external-record adapters, the same value passed to
     * `initValServer`.
     *
     * Needed here too, and not only there: an external record's content is never
     * bundled with the app, so a server component reading one has to reach the
     * store — which means this side needs the adapters as well.
     */
    external?: ExternalRecords;
  },
  valModules: ValModules,
  rscNextConfig: ValNextRscConfig,
): {
  fetchValStega: ReturnType<typeof initFetchValStega>;
  fetchValKeyStega: ReturnType<typeof initFetchValKeyStega>;
  fetchValRouteStega: ReturnType<typeof initFetchValRouteStega>;
  fetchValRouteUrl: ReturnType<typeof initFetchValRouteUrl>;
  /**
   * A page of an external record's keys.
   *
   * The reader that has no counterpart for other storage modes, because no other
   * storage mode has anything to page: a `.jsonValues()` record's keys are in
   * the module. Everything else — `fetchVal`, `fetchValKey` — is the SAME
   * function whichever mode holds the content.
   */
  fetchValKeys: ReturnType<typeof initFetchValKeys>;
  /** Many external entries in one round trip, and one transaction. */
  fetchValEntries: ReturnType<typeof initFetchValEntries>;
} {
  const coreVersion = Internal.VERSION.core;
  if (!coreVersion) {
    throw new Error("Could not get @valbuild/core package version");
  }
  const nextVersion = VERSION;
  if (!nextVersion) {
    throw new Error("Could not get @valbuild/next package version");
  }

  const valServerPromise = createValServer(
    valModules,
    "/api/val",
    {
      versions: {
        next: nextVersion,
        core: coreVersion,
      },
      ...config,
    },
    config,
    {
      async isEnabled() {
        return (await rscNextConfig.draftMode()).isEnabled;
      },
      async onEnable() {
        (await rscNextConfig.draftMode()).enable();
      },
      async onDisable() {
        (await rscNextConfig.draftMode()).disable();
      },
    },
  );
  /**
   * External records read through the in-process ValOps, not the HTTP handlers.
   * Their content is never bundled with the app, so the store has to be reached
   * on every render — draft mode or not — and the handlers correctly refuse an
   * unauthenticated caller. See `externalRsc.ts`.
   */
  const externalReader = {
    valServerPromise,
    isEnabled: async () => (await rscNextConfig.draftMode()).isEnabled,
  };
  return {
    fetchValKeys: initFetchValKeys(externalReader),
    fetchValEntries: initFetchValEntries(externalReader),
    fetchValStega: initFetchValStega(
      config,
      valApiEndpoints, // TODO: get from config
      valServerPromise,
      async () => {
        return (await rscNextConfig.draftMode()).isEnabled;
      },
      async () => {
        return await rscNextConfig.headers();
      },
      async () => {
        return await rscNextConfig.cookies();
      },
    ),
    fetchValKeyStega: initFetchValKeyStega(
      valServerPromise,
      async () => {
        return (await rscNextConfig.draftMode()).isEnabled;
      },
      async () => {
        return await rscNextConfig.cookies();
      },
    ),
    fetchValRouteStega: initFetchValRouteStega(
      config,
      valApiEndpoints,
      valServerPromise,
      async () => {
        return (await rscNextConfig.draftMode()).isEnabled;
      },
      async () => {
        return await rscNextConfig.headers();
      },
      async () => {
        return await rscNextConfig.cookies();
      },
    ),
    fetchValRouteUrl: initFetchValRouteUrl(
      config,
      valApiEndpoints,
      valServerPromise,
      async () => {
        return (await rscNextConfig.draftMode()).isEnabled;
      },
      async () => {
        return await rscNextConfig.headers();
      },
      async () => {
        return await rscNextConfig.cookies();
      },
    ),
  };
}
