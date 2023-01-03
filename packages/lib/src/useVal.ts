import { content, ValContent } from "./content";
import { object } from "./schema/object";
import { string } from "./schema/string";
import { StaticVal } from "./StaticVal";
import { Val, ValObject, ValString } from "./Val";
import { ValidTypes } from "./ValidTypes";

function buildVal<T extends ValidTypes>(id: string, val: T): Val<T> {
  if (typeof val === "string") {
    return {
      id,
      val,
    } as Val<T>;
  } else if (typeof val === "object") {
    // Should this be a Proxy / lazy or not? Is it serializable?
    return new Proxy(val, {
      get(target, prop: string) {
        if (target[prop]) {
          return buildVal(`${id}/${prop}`, target[prop]);
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

// TODO: move this to tests
{
  const val: ValString = useVal(content("foo", () => string().static("bar")));
}
{
  const val: ValObject<{ foo: string }> = useVal(
    content("foo", () => object({ foo: string() }).static({ foo: "bar" }))
  );
}
