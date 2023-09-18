import {
  GenericSelector,
  ModuleId,
  SelectorOf,
  SelectorSource,
} from "@valbuild/core";
import { StegaOfSource, getModuleIds, transform } from "@valbuild/react/stega";
// import { isValEnabled } from "./isValEnabled";
import { useValStore } from "@valbuild/react";
import { useSyncExternalStore } from "react";

export function useVal<T extends SelectorSource>(
  selector: T
): SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never {
  const valStore = useValStore();
  const enabled = true; // isValEnabled();
  if (enabled) {
    const moduleIds = getModuleIds(selector) as ModuleId[];
    const moduleMap = useSyncExternalStore(
      valStore.subscribe(moduleIds),
      valStore.getSnapshot(moduleIds),
      valStore.getServerSnapshot(moduleIds)
    );
    return transform(selector, {
      getModule: (moduleId) => {
        return moduleMap[moduleId as ModuleId];
      },
    });
  }

  return transform(selector, {
    disabled: !enabled,
  }) as SelectorOf<T> extends GenericSelector<infer S>
    ? StegaOfSource<S>
    : never;
}
