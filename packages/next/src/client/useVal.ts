import {
  GenericSelector,
  ModuleId,
  SelectorOf,
  SelectorSource,
} from "@valbuild/core";
import { StegaOfSource, getModuleIds, transform } from "@valbuild/react/stega";
import { useValStore } from "@valbuild/react";
import { useSyncExternalStore } from "react";

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
  return transform(selector, {
    getModule: (moduleId) => {
      if (moduleMap) {
        return moduleMap[moduleId as ModuleId];
      }
    },
  });
}
