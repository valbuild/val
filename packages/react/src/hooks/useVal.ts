import { useSyncExternalStore } from "react";
import { useValStore } from "../ValProvider";
import { Source, Val } from "@valbuild/lib";
import { ReactVal } from "../types";

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function wrapVal<T>(id: string, val: T): ReactVal<T> {
  switch (typeof val) {
    case "function":
    case "symbol":
      throw Error("Invalid val type");
    case "object":
      if (val !== null) {
        // Handles both objects and arrays!
        return new Proxy(val, {
          get(target, prop: string) {
            if (prop === "valId") {
              return id;
            }
            if (prop === "val") {
              return target;
            }
            if (Array.isArray(target) && prop === "length") {
              return target.length;
            }
            if (hasOwn(val, prop)) {
              return wrapVal(`${id}.${prop}`, Reflect.get(target, prop));
            }
            return Reflect.get(target, prop);
          },
        }) as ReactVal<T>;
      }
    // intentional fallthrough
    // eslint-disable-next-line no-fallthrough
    default:
      return {
        valId: id,
        val,
      } as ReactVal<T>;
  }
}

export const useVal = <T>(val: Val<T>): Val<T> => {
  const valStore = useValStore();
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

  return wrapVal(mod.id, source.get());
};
