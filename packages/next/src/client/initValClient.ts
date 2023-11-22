import {
  GenericSelector,
  Internal,
  ModuleId,
  SelectorOf,
  SelectorSource,
} from "@valbuild/core";
import {
  StegaOfSource,
  getModuleIds,
  stegaEncode,
} from "@valbuild/react/stega";
import { useValStore } from "@valbuild/react/internal";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ValConfig } from "@valbuild/core";

function useVal<T extends SelectorSource>(
  selector: T
): SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never {
  const valStore = useValStore();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(
      document.cookie.includes(`${Internal.VAL_ENABLE_COOKIE_NAME}=true`)
    );
  }, [valStore]);
  if (valStore) {
    const moduleIds = getModuleIds(selector) as ModuleId[];
    const moduleMap = useSyncExternalStore(
      valStore.subscribe(moduleIds),
      valStore.getSnapshot(moduleIds),
      valStore.getServerSnapshot(moduleIds)
    );
    return stegaEncode(selector, {
      disabled: !enabled,
      getModule: (moduleId) => {
        if (moduleMap) {
          return moduleMap[moduleId as ModuleId];
        }
      },
    });
  }
  return stegaEncode(selector, { disabled: !enabled });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initValClient(config: ValConfig): { useVal: typeof useVal } {
  return {
    useVal,
  };
}