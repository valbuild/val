import {
  SelectorSource,
  SelectorOf,
  GenericSelector,
  Val,
  Internal,
} from "@valbuild/core";
import { JsonOfSource } from "@valbuild/core/src/val";

export function useVal<T extends SelectorSource>(
  selector: T,
  locale?: string
): SelectorOf<T> extends GenericSelector<infer S>
  ? Val<JsonOfSource<S>>
  : never {
  // const mod = selectable.getModule();
  // const valStore = useValStore();
  // const remoteContent = useSyncExternalStore(
  //   valStore.subscribe(mod.id),
  //   valStore.getSnapshot(mod.id),
  //   valStore.getServerSnapshot(mod.id)
  // );
  // if (remoteContent) {
  //   return selectable.getVal(remoteContent.source as S, locale);
  // }
  // const content = mod.content;
  // const validationError = content.validate();
  // if (validationError) {
  //   throw new Error(
  //     `Invalid source value. Errors:\n${validationError.join("\n")}`
  //   );
  // }

  return Internal.getVal(selector, locale);
}
