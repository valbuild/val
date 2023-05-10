import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { Schema } from "../schema";
import { Source, SourceTuple } from "../Source";
import { Selector as BooleanSelector } from "./boolean";
import { Selector as NumberSelector } from "./number";
import { F } from "ts-toolbelt";

export type UndistributedSourceTuple<T extends SourceTuple> = [T] extends [
  infer U // infer here to avoid Type instantiation is excessively deep and possibly infinite. See: https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437. Avoiding infer extends to keep us below TS 4.9 compat
]
  ? U extends SourceTuple
    ? Selector<U>
    : never
  : never;

// TODO: docs
type Selector<T extends SourceTuple> = SelectorC<T> & {
  length: NumberSelector<number>;
  filter(
    predicate: (
      v: UnknownSelector<T[number]>
    ) => BooleanSelector<boolean> | boolean
  ): Selector<T>;
  filter<U extends Source>(schema: Schema<U>): Selector<readonly U[]>;
  map<U extends SelectorSource>(
    f: (
      v: UnknownSelector<T[number]>,
      i: UnknownSelector<number>
    ) => F.Narrow<U>
  ): SelectorOf<readonly U[]>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => F.Narrow<U>
  ): SelectorOf<U> | UnknownSelector<boolean>;
} & {
  readonly [key in keyof T]: UnknownSelector<T[key]>;
};
