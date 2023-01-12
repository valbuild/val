import { ValContent } from "./content";
import { StaticVal } from "./StaticVal";
import { Val } from "./Val";
import { ValidObject, ValidTypes, ValProps } from "./ValidTypes";

function buildVal<T extends ValidTypes>(id: string, val: T): Val<T> {
  if (typeof val === "string") {
    return {
      id,
      val,
    } as Val<T>;
  } else if (Array.isArray(val)) {
    // Should this fall-through to object if-clause or use Proxy / lazy to be consistent with object (currently a Proxy)?
    // NOTE: we want the methods on array here so probably not Proxy
    return val.map((item, index) =>
      buildVal(`${id}.${index}`, item)
    ) as unknown as Val<T>;
  } else if (typeof val === "object") {
    // Should this be a Proxy / lazy or not? Is it serializable?
    return new Proxy(val as ValidObject, {
      get(target, prop: string) {
        const idProp: keyof ValProps<T> /* type check to make sure idProp is, in fact, a prop of ValProps */ =
          "id";
        if (prop === idProp) {
          return id;
        }
        const valProp: keyof ValProps<T> /* type check to make sure valProps is, in fact, a prop of ValProps */ =
          "val";
        if (prop === valProp) {
          return val;
        }
        if (target[prop]) {
          return buildVal(`${id}.${prop}`, target[prop]);
        }
        return undefined;
      },
    }) as unknown as Val<T>;
  }
  throw new Error("Not implemented");
}

export const useVal = <T extends ValidTypes>(
  content: ValContent<T>
): Val<T> => {
  const staticVal: StaticVal<T> = content.val;
  const validationError = staticVal.schema.validate(staticVal.get());
  if (validationError) {
    throw new Error(
      `Invalid static value. Errors:\n${validationError.join("\n")}`
    );
  }
  return buildVal(content.id, staticVal.get());
};
