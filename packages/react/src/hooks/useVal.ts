import { useSyncExternalStore } from "react";
import { useValStore } from "../ValProvider";
import { Source, Val } from "@valbuild/lib";
import { Selectable } from "@valbuild/lib/src/selectable";

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

export const useVal = <T>(
  selectable: Selectable<T>,
  locale: "en_US" = "en_US"
): Val<T> => {
  return selectable.getVal(locale);
  /* const valStore = useValStore();
  const currentVal = useSyncExternalStore(
    valStore.subscribe(mod.id),
    valStore.getSnapshot(mod.id),
    valStore.getServerSnapshot(mod.id)
  );
  if (currentVal) {
    return wrapVal(mod.id, currentVal.source as SourceOf<T>);
  }
  const source = mod.content;
  const validationError = source.validate();
  if (validationError) {
    throw new Error(
      `Invalid source value. Errors:\n${validationError.join("\n")}`
    );
  }

  return wrapVal(mod.id, source.get()); */
};
