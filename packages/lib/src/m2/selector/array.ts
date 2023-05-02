import {
  AsVal,
  MODULE_ID,
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  SOURCE,
  VAL,
} from ".";
import { Schema } from "../schema";
import { ArraySchema } from "../schema/array";
import { Source, SourceArray } from "../Source";
import { ModuleId, SourcePath, Val } from "../val";
import { createArraySelector, createSelector } from "./create";

export type UndistributedSourceArray<T extends SourceArray> = [T] extends [
  infer U // infer here to avoid Type instantiation is excessively deep and possibly infinite. See: https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437. Avoiding infer extends to keep us below TS 4.9 compat
]
  ? U extends SourceArray
    ? Selector<U>
    : never
  : never;

type Selector<T extends SourceArray> = ArraySelector<T> & {
  readonly [key in keyof T & number]: UnknownSelector<T[key]>;
};

export class ArraySelector<T extends SourceArray>
  extends SelectorC<T>
  implements AsVal<T>
{
  [VAL](): Val<T> {
    throw Error("TODO: implement me");
  }
  readonly length: UnknownSelector<T["length"]> = null as never; // TODO: !

  filter(
    predicate: (v: UnknownSelector<T[number]>) => SelectorOf<boolean>
  ): SelectorOf<T> {
    throw Error("TODO: implement me");
  }
  map<U extends SelectorSource>(
    f: (v: UnknownSelector<T[number]>, i: UnknownSelector<number>) => U
  ): SelectorOf<U[]> {
    const source = this[SOURCE]();
    const a = source.map((_v, i) => {
      const result = f(
        createSelector(
          (this.sourcePath + "." + i) as SourcePath,
          (this.schema as unknown as ArraySchema<Schema<T[number]>>).item,
          source[i]
        ) as unknown as UnknownSelector<T[number]>,
        null as unknown /* TODO */ as UnknownSelector<number>
      ) as unknown as U;
      return result;
    }) as unknown as SelectorOf<U[]>;
    const currentPath = this.sourcePath;
    return new Proxy(a, {
      get(target, prop) {
        if (prop === VAL) {
          return () => {
            return {
              valPath: currentPath,
              val: a.map((v) => v[VAL]().val),
            };
          };
        }
        return target[Number(prop)];
      },
    });
  }
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U> {
    throw Error("TODO: implement me");
  }
}
