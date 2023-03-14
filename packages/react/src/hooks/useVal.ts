import {
  ValModule,
  Val,
  ValString,
  SourceObject,
  Source,
  ValProps,
} from "@valbuild/lib";
import { useContext, useSyncExternalStore } from "react";
import { useValStore, ValContext } from "../ValProvider";

const idProp: keyof ValProps<unknown> /* type check to make sure idProp is, in fact, a prop of ValProps */ =
  "valId";
const valProp: keyof ValProps<unknown> /* type check to make sure valProps is, in fact, a prop of ValProps */ =
  "val";

function buildVal<T extends Source>(id: string, val: T): Val<T> {
  if (typeof val === "string") {
    return {
      valId: id,
      val,
    } as ValString as Val<T>;
  } else if (Array.isArray(val)) {
    // Should this fall-through to object if-clause or use Proxy / lazy to be consistent with object (currently a Proxy)?
    // NOTE: we want the methods on array here so probably not Proxy
    return val.map((item, index) => buildVal(`${id}.${index}`, item)) as Val<T>;
  } else if (typeof val === "object") {
    // Should this be a Proxy / lazy or not? Is it serializable?
    return new Proxy(val as SourceObject, {
      get(target, prop: string) {
        if (prop === idProp) {
          return id;
        }
        if (prop === valProp) {
          return val;
        }
        if (target[prop]) {
          return buildVal(`${id}.${prop}`, target[prop]);
        }
        return undefined;
      },
    }) as Val<T>;
  }
  throw new Error("Not implemented");
}

export const useVal = <T extends Source>(mod: ValModule<T>): Val<T> => {
  const valStore = useValStore();
  const currentVal = useSyncExternalStore(
    valStore.subscribe(mod.id),
    valStore.getSnapshot(mod.id),
    valStore.getServerSnapshot(mod.id)
  );
  if (currentVal) {
    return buildVal(mod.id, currentVal.source as T);
  }
  const content = mod.content;
  const validationError = content.schema.validate(content.get());
  if (validationError) {
    throw new Error(
      `Invalid static value. Errors:\n${validationError.join("\n")}`
    );
  }
  return buildVal(mod.id, content.get());
};
