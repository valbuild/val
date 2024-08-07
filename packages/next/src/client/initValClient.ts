import {
  GenericSelector,
  Internal,
  ModuleFilePath,
  SelectorOf,
  SelectorSource,
} from "@valbuild/core";
import {
  StegaOfSource,
  getModuleIds,
  stegaEncode,
} from "@valbuild/react/stega";
import React from "react";
import { ValConfig } from "@valbuild/core";
import { useValEvents } from "../ValContext";

export type UseValType<T extends SelectorSource> =
  SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never;
function useValStega<T extends SelectorSource>(selector: T): UseValType<T> {
  const [enabled, setEnabled] = React.useState(false);
  const valEvents = useValEvents();
  React.useEffect(() => {
    setEnabled(
      document.cookie.includes(`${Internal.VAL_ENABLE_COOKIE_NAME}=true`)
    );
  }, [valEvents]);
  if (valEvents) {
    const moduleIds = getModuleIds(selector) as ModuleFilePath[];
    React.useEffect(() => {
      // NOTE: we need to know when a re-render has happened so we can reload the modules if necessary.
      // TODO: feels like we can do some optimizations here
      if (enabled) {
        valEvents.reloadPaths(moduleIds);
      }
    });
    const moduleMap = React.useSyncExternalStore(
      valEvents.subscribe(moduleIds),
      valEvents.getSnapshot(moduleIds),
      valEvents.getServerSnapshot(moduleIds)
    );
    return stegaEncode(selector, {
      disabled: !enabled,
      getModule: (moduleId) => {
        if (moduleMap && enabled) {
          return moduleMap[moduleId as ModuleFilePath];
        }
      },
    });
  }
  return stegaEncode(selector, { disabled: !enabled });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initValClient(config: ValConfig): {
  useValStega: typeof useValStega;
} {
  return {
    useValStega,
  };
}
