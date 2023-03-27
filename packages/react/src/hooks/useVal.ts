import { useSyncExternalStore } from "react";
import { useValStore } from "../ValProvider";
import { Source, Val } from "@valbuild/lib";
import { Selectable } from "@valbuild/lib/src/selectable";

export const useVal = <Src extends Source, Localized extends Source>(
  selectable: Selectable<Src, Localized>,
  locale: "en_US" = "en_US"
): Val<Localized> => {
  const mod = selectable.getModule();
  const valStore = useValStore();
  const remoteContent = useSyncExternalStore(
    valStore.subscribe(mod.id),
    valStore.getSnapshot(mod.id),
    valStore.getServerSnapshot(mod.id)
  );
  if (remoteContent) {
    return selectable.getVal(remoteContent.source as Src, locale);
  }
  const content = mod.content;
  const validationError = content.validate();
  if (validationError) {
    throw new Error(
      `Invalid source value. Errors:\n${validationError.join("\n")}`
    );
  }

  return selectable.getVal(content.source as Src, locale);
};
