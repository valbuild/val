import { draftMode } from "next/headers";
import {
  getModuleIds,
  fetchVal as rawFetchVal,
  type StegaOfSource,
} from "@valbuild/react/stega";
import { SelectorSource, SelectorOf, GenericSelector } from "@valbuild/core";

export function fetchVal<T extends SelectorSource>(
  selector: T
): SelectorOf<T> extends GenericSelector<infer S>
  ? Promise<StegaOfSource<S>>
  : never {
  if (draftMode().isEnabled) {
    getModuleIds(selector).map((moduleId) => {
      // fetch
    });
  }
  return rawFetchVal<T>(selector);
}
