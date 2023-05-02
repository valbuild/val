import {
  AsVal,
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  VAL,
} from ".";
import { Source, SourcePrimitive } from "../Source";
import { Val } from "../val";

export type OptionalSelector<T> = T extends undefined ? Selector<T> : never;

type Selector<T extends Source> = OptionalSelectorC<T>;

class OptionalSelectorC<T extends Source>
  extends SelectorC<T | undefined>
  implements AsVal<T | undefined>
{
  eq(other: SourcePrimitive): UnknownSelector<boolean> {
    throw Error("TODO: implement me");
  }
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): [T] extends [never]
    ? Selector<undefined>
    : SelectorOf<U> | Selector<undefined> {
    throw Error("TODO: implement me");
  }
  [VAL](): Val<T | undefined> {
    throw Error("TODO: implement me");
  }
}
