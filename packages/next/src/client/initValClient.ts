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
import { initValRouteFromVal } from "../initValRouteFromVal";

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

function useValRouteStega<T extends ValModule<GenericSelector<SourceObject>>>(
  selector: T,
  params:
    | Record<string, string | string[]>
    | Promise<Record<string, string | string[]>>,
): UseValRouteReturnType<T> {
  const val = useValStega(selector);
  let resolvedParams: Record<string, string | string[]> | undefined =
    "then" in params ? undefined : params;
  if ("then" in params) {
    if ("use" in React) {
      // This feels fairly safe: use should be possible to use inside if (?) and the if should most likely
      resolvedParams = React.use(
        params as Promise<Record<string, string | string[]>>,
      );
    } else {
      console.error(
        `Val: useValRoute params argument was promise, but the React.use hook is available. Please resolve the promise before passing it to useValRoute (or upgrade to React 19+).`,
      );
      return null as UseValRouteReturnType<T>;
    }
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initValClient(config: ValConfig): {
  useValStega: typeof useValStega;
  useValRouteStega: typeof useValRouteStega;
} {
  return {
    useValStega,
    useValRouteStega,
  };
}
