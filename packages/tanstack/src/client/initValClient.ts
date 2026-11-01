import {
  GenericSelector,
  Internal,
  Json,
  ModuleFilePath,
  type ResolvableModule,
  SelectorSource,
  SourceObject,
  ValModule,
} from "@valbuild/core";
import {
  type JsonEntryContentOf,
  type Resolvable,
  type ResolvedVal,
  type RouteValueOf,
  getModuleIds,
} from "@valbuild/react/stega";
import React from "react";
import { ValConfig } from "@valbuild/core";
import { useValOverlayContext } from "../ValOverlayContext";
import { useHydrated } from "../useHydrated";
import {
  readEntryWithOverlay,
  readRouteEntryWithOverlay,
  readSelectorWithOverlay,
  type CommittedEntries,
} from "./overlayRead";
import {
  bundledJsonEntryImport,
  getValRouteUrlFromVal,
  initValRouteFromVal,
  isJsonValuesRecordSchema,
} from "../routeFromVal";

/**
 * Whether the content this component renders carries its edit tags.
 *
 * Always in draft mode -- except, on a page rendered from a server-read draft,
 * for the server's render and for this component's own hydration render: then
 * the draft text goes out without them, and the render React does right after
 * hydrating the component puts them in.
 *
 * With analytics on and draft mode off, the same rule for every visitor: no
 * tags on the server or while hydrating, tags from the render after. So the
 * content of the HTML a visitor is sent, prerendered or not, is the same with
 * analytics on or off -- what differs is the few bytes of JSON that say it is
 * on (`platformAnalytics.tsx`) -- and no edit tag ever reaches a crawler that
 * does not run the page.
 *
 * Because JSX auto-tagging turns a tagged string into a `data-val-path`
 * attribute as the element is created, and the switch for it is process-wide.
 * The server cannot be relied on to tag (whether the patched JSX runtime is
 * the one it renders with depends on how it was bundled), and no page-wide
 * moment means "everything has hydrated": a split-out route, or a lazy child
 * handed a string as a prop, hydrates after the rest of the page. A string
 * with no tags in it has nothing to tag, wherever it is rendered and whatever
 * the switch says -- so the server's HTML and every hydration render agree.
 */
function useEncodesEditTags(context: {
  draftMode: boolean | null;
  serverDraft?: boolean;
  analytics?: boolean;
}): boolean {
  const hydrated = useHydrated();
  if (context.draftMode) {
    return !context.serverDraft || hydrated;
  }
  return !!context.analytics && hydrated;
}

/** What `useVal` gives back — see `ResolvedVal` in `@valbuild/react/stega`. */
export type UseValType<T extends SelectorSource> = ResolvedVal<T>;
function useValStega<T extends Resolvable>(selector: T): UseValType<T> {
  const valOverlayContext = useValOverlayContext();
  const encodes = useEncodesEditTags(valOverlayContext);
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
  /*
   * A whole `.jsonValues()` record is read with every entry's content: its own
   * source holds only lazy markers. The entries no draft or snapshot has are
   * imported from the bundle -- all of them started before waiting on any, so
   * they load together. `useValKey` is the reader for one entry.
   */
  return readSelectorWithOverlay(
    selector,
    {
      moduleMap,
      draftMode: valOverlayContext.draftMode,
      snapshot: valOverlayContext.snapshot,
    },
    encodes,
    suspendOnCommittedEntries,
  );
}

/** {@link CommittedEntries} for a component: every import started, then each awaited with `React.use`. */
const suspendOnCommittedEntries: CommittedEntries = (
  module,
  modulePath,
  keys,
) => {
  const pending = keys.map((key) =>
    committedJsonEntryPromise(module, modulePath, key),
  );
  return pending.map((promise) =>
    promise === undefined ? undefined : React.use(promise),
  );
};

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
  if (!moduleFilePath) {
    return undefined;
  }
  // A proposal's saved Source stands in for the bundle's, draft or not.
  const snapshot = valOverlayContext.snapshot?.[moduleFilePath];
  if (!valOverlayContext.draftMode) {
    return snapshot;
  }
  return moduleMap?.[moduleFilePath] ?? snapshot;
}

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
function useValKeyStega<T extends ResolvableModule>(
  selector: T,
  key: string,
): JsonEntryContentOf<T> | undefined {
  const valOverlayContext = useValOverlayContext();
  const encodes = useEncodesEditTags(valOverlayContext);
  // A view is a pointer: everything below reads a path, a schema and a source
  // off this, and a pointer has none of them. See `resolveViewedModule`.
  const valModule = Internal.resolveViewedModule<SourceObject>(selector);
  const moduleFilePath =
    valModule && (Internal.getValPath(valModule) as unknown as ModuleFilePath);
  const draftSource = useDraftModuleSource(moduleFilePath || undefined);
  // Deleted in the draft state: `undefined`, never the bundled entry, which
  // would render content the editor has just removed.
  return readEntryWithOverlay(
    valModule,
    key,
    draftSource,
    moduleFilePath ? valOverlayContext.snapshot?.[moduleFilePath] : undefined,
    encodes,
    readCommittedJsonEntry,
  );
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
  const promise = committedJsonEntryPromise(
    selector,
    Internal.getValPath(selector) as unknown as ModuleFilePath | undefined,
    key,
  );
  return promise === undefined ? undefined : React.use(promise);
}

/**
 * The bundle's import of one entry, started once and kept, so every render
 * that waits on it is handed the same promise (`React.use` needs that).
 * `undefined` when the module has no import for `key`.
 */
function committedJsonEntryPromise(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  module: any,
  modulePath: ModuleFilePath | undefined,
  key: string,
): Promise<unknown> | undefined {
  const cacheKey = `${modulePath ?? ""} ${key}`;
  let promise = jsonEntryPromiseCache.get(cacheKey);
  if (!promise) {
    const thunk = bundledJsonEntryImport(module, key);
    if (!thunk) {
      return undefined;
    }
    promise = thunk().then((mod) => mod.default);
    jsonEntryPromiseCache.set(cacheKey, promise);
  }
  return promise;
}

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
      Internal.log.error(
        "useValRoute received a Promise params argument but React.use is unavailable. Upgrade to React 19+ or pre-resolve the promise before passing it.",
      );
      return null;
    }
    return React.use(params as Promise<Record<string, string | string[]>>);
  }
  return params;
}

function useValRouteStega<T extends ResolvableModule>(
  selector: T,
  params:
    | Record<string, string | string[]>
    | Promise<Record<string, string | string[]>>,
): RouteValueOf<T> {
  const valOverlayContext = useValOverlayContext();
  // A view is a pointer: everything below reads a path, a schema and a source
  // off this, and a pointer has none of them. See `resolveViewedModule`.
  const valModule = Internal.resolveViewedModule<SourceObject>(selector);
  // Both called unconditionally to keep hook order stable. For a `.jsonValues()`
  // router `val` is unused (we resolve a single entry below instead); for any
  // other router `draftSource` is.
  const val = useValStega(valModule);
  const encodes = useEncodesEditTags(valOverlayContext);
  const moduleFilePath =
    (valModule &&
      (Internal.getValPath(valModule) as unknown as ModuleFilePath)) ||
    undefined;
  const draftSource = useDraftModuleSource(moduleFilePath);
  const resolvedParams = resolveParams(params);
  // Careful: null means there was an error - undefined means no params
  if (resolvedParams === null) {
    return null as RouteValueOf<T>;
  }
  const path = valModule && Internal.getValPath(valModule);
  const schema = valModule && Internal.getSchema(valModule);
  // `.jsonValues()` router: map params → the entry key and load ONLY that
  // entry's backing `*.val.json` (one dynamic import), like `useValKey`.
  if (isJsonValuesRecordSchema(schema)) {
    return readRouteEntryWithOverlay(
      valModule,
      resolvedParams || {},
      draftSource,
      moduleFilePath ? valOverlayContext.snapshot?.[moduleFilePath] : undefined,
      encodes,
      readCommittedJsonEntry,
    );
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

function useValRouteUrl<T extends ResolvableModule>(
  selector: T,
  params?:
    | Record<string, string | string[]>
    | Promise<Record<string, string | string[]>>,
): string | null {
  // A view is a pointer: everything below reads a path, a schema and a source
  // off this, and a pointer has none of them. See `resolveViewedModule`.
  const valModule = Internal.resolveViewedModule<SourceObject>(selector);
  const val = useValStega(valModule);
  const resolvedParams =
    params === undefined ? undefined : resolveParams(params);
  // Careful: null means there was an error - undefined means no params
  if (resolvedParams === null) {
    return null;
  }
  const route = getValRouteUrlFromVal(
    resolvedParams || {},
    "useValRouteUrl",
    valModule && Internal.getValPath(valModule),
    valModule && Internal.getSchema(valModule),
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
