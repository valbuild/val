import { useSyncExternalStore } from "react";
import { useValStore } from "../ValProvider";
import { Source, Val, Selectable } from "@valbuild/lib";

export const useVal = <S extends Source, Out extends Source>(
  selectable: Selectable<S, Out>,
  locale: "en_US" = "en_US"
): Val<Out> => {
  const mod = selectable.getModule();
  const valStore = useValStore();
  const remoteContent = useSyncExternalStore(
    valStore.subscribe(mod.id),
    valStore.getSnapshot(mod.id),
    valStore.getServerSnapshot(mod.id)
  );
  if (remoteContent) {
    return selectable.getVal(remoteContent.source as S, locale);
  }
  const content = mod.content;
  const validationError = content.validate();
  if (validationError) {
    throw new Error(
      `Invalid source value. Errors:\n${validationError.join("\n")}`
    );
  }

  return selectable.getVal(content.source, locale);
};
