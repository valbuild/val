import {
  GenericSelector,
  Internal,
  Json,
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
import { getValRouteUrlFromVal, initValRouteFromVal } from "../routeFromVal";
import { valSuspense } from "./valSuspense";

export type UseValType<T extends SelectorSource> =
  SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never;
function useValStega<T extends SelectorSource>(selector: T): UseValType<T> {
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
  // Suspense (Val-enabled branch only). The gate is `enabled` (the VAL_ENABLE
  // cookie), not `draftMode`: `enabled` is stable for the lifetime of the page
  // whereas `draftMode` is polled and can change, and we must not start/stop
  // suspending across renders. The production path (Val not enabled) skips the
  // call entirely. Calling valSuspense conditionally is safe: it either calls
  // React.use — which React permits inside conditionals and loops — or throws
  // the promise for classic Suspense, neither of which is a hook.
  if (valOverlayContext.enabled && store && !store.hasAllLoaded(moduleIds)) {
    valSuspense(store.waitForLoad(moduleIds));
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

type UseValRouteReturnType<T extends ValModule<GenericSelector<SourceObject>>> =
  T extends ValModule<infer S>
    ? S extends SourceObject
      ? StegaOfSource<NonNullable<S>[string]> | null
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
    // Suspend on the params promise. valSuspense centralizes the React.use
    // (React 19) vs throw-promise (React 18) split, so both paths just need a
    // <Suspense> boundary higher up the tree.
    return valSuspense(params as Promise<Record<string, string | string[]>>);
  }
  return params;
}

function useValRouteStega<T extends ValModule<GenericSelector<SourceObject>>>(
  selector: T,
  params:
    | Record<string, string | string[]>
    | Promise<Record<string, string | string[]>>,
): UseValRouteReturnType<T> {
  const val = useValStega(selector);
  const resolvedParams = resolveParams(params);
  // Careful: null means there was an error - undefined means no params
  if (resolvedParams === null) {
    return null as UseValRouteReturnType<T>;
  }
  const route = initValRouteFromVal(
    resolvedParams || {},
    "useValRoute",
    selector && Internal.getValPath(selector),
    selector && Internal.getSchema(selector),
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
  useValRouteStega: typeof useValRouteStega;
  useValRouteUrl: typeof useValRouteUrl;
} {
  return {
    useValStega,
    useValRouteStega,
    useValRouteUrl,
  };
}
