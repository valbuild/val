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
import { useValStore } from "@valbuild/react";
import { useEffect, useState, useSyncExternalStore } from "react";

export function useVal<T extends SelectorSource>(
  selector: T
): SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never {
  const valStore = useValStore();
  const moduleIds = getModuleIds(selector) as ModuleId[];
  const moduleMap = useSyncExternalStore(
    valStore.subscribe(moduleIds),
    valStore.getSnapshot(moduleIds),
    valStore.getServerSnapshot(moduleIds)
  );
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(
      document.cookie.includes(`${Internal.VAL_ENABLE_COOKIE_NAME}=true`)
    );
  }, []);
  return stegaEncode(selector, {
    disabled: !enabled,
    getModule: (moduleId) => {
      if (moduleMap) {
        return moduleMap[moduleId as ModuleId];
      }
    },
  });
}
