import {
  GenericSelector,
  Internal,
  Json,
  JsonSource,
  ModuleFilePath,
  SelectorOf,
  SelectorSource,
  SourceObject,
  ValModule,
} from "@valbuild/core";
import {
  StegaOfSource,
  getModuleIds,
  stegaEncode,
} from "@valbuild/react/stega";
import React from "react";
import { ValConfig } from "@valbuild/core";
import { useValOverlayContext } from "../ValOverlayContext";
import {
  getJsonEntryStegaRoot,
  getValRouteUrlFromVal,
  initValRouteFromVal,
  isJsonValuesRecordSchema,
} from "../routeFromVal";

export type UseValType<T extends SelectorSource> =
  SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never;
function useValStega<T extends SelectorSource>(selector: T): UseValType<T> {
  refuseExternalInClient(selector, "useVal");
  const valOverlayContext = useValOverlayContext();
  const moduleIds = React.useMemo(
    () => getModuleIds(selector) as ModuleFilePath[],
    [selector],
  );
  const store = valOverlayContext.store;
  const moduleMap = React.useSyncExternalStore(
    store ? store.subscribe(moduleIds) : () => () => {},
    store
      ? store.getSnapshot(moduleIds)
      : (): Record<ModuleFilePath, Json> | undefined => {
          return;
        },
    store
      ? store.getServerSnapshot(moduleIds)
      : (): Record<ModuleFilePath, Json> | undefined => {
          return;
        },
  );
  // Suspense gate. `suspend` is false during SSR and hydration (so the static
  // committed source is rendered, matching the server HTML exactly) and is
  // activated by ValProvider after hydration — inside a transition — when the
  // `suspend` prop is set AND the Val Enable cookie is present (checked
  // client-side; the server store is never populated). It never deactivates.
  // The production path (no cookie) skips the call entirely. The
  // `draftMode !== false` check is a release valve: with draft mode off the
  // store never receives source updates, so waitForLoad could only ever
  // resolve via its timeout — and would then re-suspend on every subsequent
  // render since the resolved promise is evicted from the cache. draftMode is
  // null until the first /draft/stat poll resolves; null -> true keeps
  // suspending, -> false only unblocks, and false -> true happens only on an
  // explicit draft-mode enable which already refreshes the route.
  // React.use is allowed inside conditionals — it is not a hook.
  /**
   * Wait until draft mode is KNOWN, before anything else.
   *
   * `draftMode === null` means `/draft/stat` has not answered yet, and the
   * `getModule` below treats it as off — so a render that slips through here
   * while it is unknown resolves against committed source. For an ordinary field
   * that is a flash of published content; for `useValRoute` on a route that
   * exists only in an uncommitted patch it is `notFound()`, which no later
   * answer can undo. That was the 404 on a page you had just created.
   */
  if (
    valOverlayContext.suspend &&
    valOverlayContext.draftMode === null &&
    valOverlayContext.draftModeReady
  ) {
    React.use(valOverlayContext.draftModeReady);
  }
  /**
   * Then wait for the draft sources — but only while more might be coming.
   *
   * `draftSourcesSynced` is the editor saying it has sent everything it holds,
   * and it only holds modules with patches: an unedited module has no draft, so
   * nothing is ever sent for it. Without that signal this could not tell "not
   * sent yet" from "nothing to send", and waited out `waitForLoad`'s ten second
   * timeout once per unedited module the page reads — which is what left a newly
   * created page sitting on its loading fallback.
   */
  if (
    valOverlayContext.suspend &&
    valOverlayContext.draftMode !== false &&
    !valOverlayContext.draftSourcesSynced &&
    store &&
    !store.hasAllLoaded(moduleIds)
  ) {
    React.use(store.waitForLoad(moduleIds));
  }
  return stegaEncode(selector, {
    disabled: !valOverlayContext.draftMode,
    getModule: (moduleId) => {
      if (moduleMap && valOverlayContext.draftMode) {
        return moduleMap[moduleId as ModuleFilePath];
      }
    },
  });
}

/**
 * The module's source as the overlay currently sees it — i.e. WITH the editor's
 * unpublished changes — or undefined when there is no draft view to be had
 * (production, draft mode off, or the overlay has not pushed this module yet).
 *
 * This is what lets the single-entry readers show drafts. They otherwise resolve
 * an entry through its local import thunk, which is the content that was bundled:
 * correct in production, and stale the moment anyone edits in the Studio.
 */
function useDraftModuleSource(
  moduleFilePath: ModuleFilePath | undefined,
): Json | undefined {
  const valOverlayContext = useValOverlayContext();
  const store = valOverlayContext.store;
  const moduleIds = React.useMemo(
    () => (moduleFilePath ? [moduleFilePath] : []),
    [moduleFilePath],
  );
  const moduleMap = React.useSyncExternalStore(
    store ? store.subscribe(moduleIds) : () => () => {},
    store
      ? store.getSnapshot(moduleIds)
      : (): Record<ModuleFilePath, Json> | undefined => undefined,
    store
      ? store.getServerSnapshot(moduleIds)
      : (): Record<ModuleFilePath, Json> | undefined => undefined,
  );
  if (!valOverlayContext.draftMode || !moduleFilePath) {
    return undefined;
  }
  return moduleMap?.[moduleFilePath];
}

/**
 * What the draft view says about one `.jsonValues()` entry.
 *
 * Mirrors the server-side rule in `fetchValKey`/`fetchValRoute`: a draft view
 * that HAS an answer wins, including the answer "this entry is gone", and the
 * bundled content is used only when there is no draft view.
 */
function draftJsonEntry(
  draftSource: Json | undefined,
  key: string,
):
  | { status: "content"; content: unknown }
  | { status: "absent" }
  | { status: "unavailable" } {
  if (
    draftSource === undefined ||
    draftSource === null ||
    typeof draftSource !== "object" ||
    Array.isArray(draftSource)
  ) {
    return { status: "unavailable" };
  }
  const entry = (draftSource as Record<string, unknown>)[key];
  if (entry === undefined) {
    // The module IS in the draft view and this key is not: it was deleted.
    return { status: "absent" };
  }
  if (Internal.isJson(entry)) {
    // An un-loaded marker: the Studio has not fetched this entry's content, so
    // the draft view cannot answer. (The engine asks for entries that pending
    // patches touch, so this resolves itself for anything actually edited.)
    return { status: "unavailable" };
  }
  return { status: "content", content: entry };
}

// The (loosened) content type a single `.jsonValues()` entry resolves to.
type JsonEntryContentOf<T extends ValModule<GenericSelector<SourceObject>>> =
  T extends ValModule<infer S>
    ? S extends Record<string, infer V>
      ? V extends JsonSource<infer C>
        ? C
        : never
      : never
    : never;

// Module-level cache of in-flight/resolved entry loads, so `React.use` gets a
// stable promise across renders (keyed by module path + entry key).
const jsonEntryPromiseCache = new Map<string, Promise<unknown>>();

/**
 * Client counterpart to `fetchValKey`: resolves a SINGLE `.jsonValues()` entry
 * by key, loading only that entry's backing `*.val.json` (one dynamic import).
 * Suspends (via `React.use`) until the entry loads, so it must be rendered
 * inside a `<Suspense>` boundary.
 *
 * In draft mode it renders the editor's unpublished content, taken from the
 * overlay; in production — and whenever there is no draft view — it resolves the
 * entry's lazy import thunk from the local module.
 */
/**
 * An external record cannot be read from a client component, and saying so is
 * better than rendering nothing.
 *
 * Every other kind of Val content is bundled with the app, so a client component
 * already holds it. An external record's content is only ever in the store, and
 * reaching the store from a browser would mean either exposing the read endpoint
 * to anonymous callers — enumerating someone's product table is not a capability
 * to hand out by accident — or working in the Studio and failing in production,
 * which is the worse of the two.
 *
 * So it is a thrown error naming the fix, not a silent `undefined`. Read it in a
 * server component with `fetchVal`, `fetchValKey` or `fetchValKeys` and pass the
 * result down as a prop.
 */
function refuseExternalInClient(selector: unknown, hook: string): void {
  if (!Internal.isValModule(selector)) {
    return;
  }
  if (!Internal.isExternal(Internal.getSource(selector))) {
    return;
  }
  throw new Error(
    `Val: ${hook} cannot read ${Internal.getValPath(selector)} — its entries are .external(), so they are not bundled with the app. Read it in a server component (fetchVal, fetchValKey or fetchValKeys) and pass the result to this component as a prop.`,
  );
}

function useValKeyStega<T extends ValModule<GenericSelector<SourceObject>>>(
  selector: T,
  key: string,
): JsonEntryContentOf<T> | undefined {
  refuseExternalInClient(selector, "useValKey");
  const valOverlayContext = useValOverlayContext();
  const moduleFilePath =
    selector && (Internal.getValPath(selector) as unknown as ModuleFilePath);
  const draftSource = useDraftModuleSource(moduleFilePath || undefined);
  const draft = draftJsonEntry(draftSource, key);
  if (draft.status === "absent") {
    // Deleted in the draft state. Falling back to the bundled entry here would
    // render content the editor has just removed.
    return undefined;
  }
  let content: unknown = draft.status === "content" ? draft.content : undefined;
  if (content === undefined) {
    content = readCommittedJsonEntry(selector, key);
  }
  return stegaEncode(content, {
    disabled: !valOverlayContext.draftMode,
    root: getJsonEntryStegaRoot(selector, key),
  });
}

/**
 * The entry's content as bundled: its lazy import thunk, resolved through
 * `React.use` so the caller suspends until it lands.
 *
 * Deliberately not named `use*`: it is called conditionally, which is fine
 * because `React.use` is not a hook, but a `use*` name would read like one.
 */
function readCommittedJsonEntry(
  selector: ValModule<GenericSelector<SourceObject>>,
  key: string,
): unknown {
  const source = selector && Internal.getSource(selector);
  const marker =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)[key]
      : undefined;
  if (!Internal.isJson(marker)) {
    return undefined;
  }
  const thunk = Internal.getJsonImport(marker);
  if (!thunk) {
    return undefined;
  }
  const cacheKey = `${Internal.getValPath(selector) ?? ""} ${key}`;
  let promise = jsonEntryPromiseCache.get(cacheKey);
  if (!promise) {
    promise = thunk().then((mod) => mod.default);
    jsonEntryPromiseCache.set(cacheKey, promise);
  }
  return React.use(promise);
}

type UseValRouteReturnType<T extends ValModule<GenericSelector<SourceObject>>> =
  T extends ValModule<infer S>
    ? S extends SourceObject
      ? // `.jsonValues()` router: the matched entry resolves to its json content.
        NonNullable<S>[string] extends JsonSource<infer C>
        ? C | null
        : StegaOfSource<NonNullable<S>[string]> | null
      : never
    : never;

function resolveParams(
  params:
    | Record<string, string | string[]>
    | Promise<Record<string, string | string[]>>,
) {
  if (!params) {
    return null;
  }
  if ("then" in params) {
    // Defensive guard: peerDependencies declare React >=19, but if a consumer
    // somehow ends up on React 18 with a promise params arg, surface a
    // diagnosable error instead of a cryptic `TypeError: React.use is not a
    // function`. Callers treat null as the error sentinel.
    if (!("use" in React)) {
      console.error(
        "Val: useValRoute received a Promise params argument but React.use is unavailable. Upgrade to React 19+ or pre-resolve the promise before passing it.",
      );
      return null;
    }
    return React.use(params as Promise<Record<string, string | string[]>>);
  }
  return params;
}

function useValRouteStega<T extends ValModule<GenericSelector<SourceObject>>>(
  selector: T,
  params:
    | Record<string, string | string[]>
    | Promise<Record<string, string | string[]>>,
): UseValRouteReturnType<T> {
  const valOverlayContext = useValOverlayContext();
  // Both called unconditionally to keep hook order stable. For a `.jsonValues()`
  // router `val` is unused (we resolve a single entry below instead); for any
  // other router `draftSource` is.
  const val = useValStega(selector);
  const draftSource = useDraftModuleSource(
    (selector &&
      (Internal.getValPath(selector) as unknown as ModuleFilePath)) ||
      undefined,
  );
  const resolvedParams = resolveParams(params);
  // Careful: null means there was an error - undefined means no params
  if (resolvedParams === null) {
    return null as UseValRouteReturnType<T>;
  }
  const path = selector && Internal.getValPath(selector);
  const schema = selector && Internal.getSchema(selector);
  // `.jsonValues()` router: map params → the entry key and load ONLY that
  // entry's backing `*.val.json` (one dynamic import), like `useValKey`.
  if (isJsonValuesRecordSchema(schema)) {
    const source = selector && Internal.getSource(selector);
    const url = getValRouteUrlFromVal(
      resolvedParams || {},
      "useValRoute",
      path,
      schema,
      source,
    );
    if (!url) {
      return null as UseValRouteReturnType<T>;
    }
    const draft = draftJsonEntry(draftSource, url);
    if (draft.status === "absent") {
      // The draft state says this route is gone — see useValKeyStega.
      return null as UseValRouteReturnType<T>;
    }
    let content: unknown =
      draft.status === "content" ? draft.content : undefined;
    if (content === undefined) {
      content = readCommittedJsonEntry(selector, url);
    }
    if (content === undefined) {
      return null as UseValRouteReturnType<T>;
    }
    return stegaEncode(content, {
      disabled: !valOverlayContext.draftMode,
      root: getJsonEntryStegaRoot(selector, url),
    });
  }
  const route = initValRouteFromVal(
    resolvedParams || {},
    "useValRoute",
    path,
    schema,
    val,
  );
  return route;
}

function useValRouteUrl<T extends ValModule<GenericSelector<SourceObject>>>(
  selector: T,
  params?:
    | Record<string, string | string[]>
    | Promise<Record<string, string | string[]>>,
): string | null {
  const val = useValStega(selector);
  const resolvedParams =
    params === undefined ? undefined : resolveParams(params);
  // Careful: null means there was an error - undefined means no params
  if (resolvedParams === null) {
    return null;
  }
  const route = getValRouteUrlFromVal(
    resolvedParams || {},
    "useValRouteUrl",
    selector && Internal.getValPath(selector),
    selector && Internal.getSchema(selector),
    val,
  );
  return route;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initValClient(config: ValConfig): {
  useValStega: typeof useValStega;
  useValKeyStega: typeof useValKeyStega;
  useValRouteStega: typeof useValRouteStega;
  useValRouteUrl: typeof useValRouteUrl;
} {
  return {
    useValStega,
    useValKeyStega,
    useValRouteStega,
    useValRouteUrl,
  };
}
