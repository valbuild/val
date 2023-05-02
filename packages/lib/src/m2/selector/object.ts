import {
  AsVal,
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  VAL,
} from ".";
import { SourceObject } from "../Source";
import { Val } from "../val";

export type UndistributedSourceObject<T extends SourceObject> = [T] extends [
  SourceObject
]
  ? Selector<T>
  : never;

type Selector<T extends SourceObject> = ObjectSelector<T> & {
  readonly [key in keyof T]: UnknownSelector<T[key]>;
};

export class ObjectSelector<T extends SourceObject>
  extends SelectorC<T>
  implements AsVal<T>
{
  match<
    Tag extends keyof T,
    R extends SelectorSource,
    Cases extends {
      [Value in T as Value[Tag] & string]: (
        v: UndistributedSourceObject<Value>
      ) => R;
    }
  >(
    key: Tag,
    cases: Cases
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Cases[T[Tag] & string] extends (v: any) => infer R
    ? R extends SelectorSource
      ? SelectorOf<R>
      : never
    : never {
    throw Error("TODO: implement me");
  }
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<T>) => U
  ): SelectorOf<U> {
    throw Error("TODO: implement me");
  }

  [VAL](): Val<T> {
    throw Error("TODO: implement me");
  }
}
