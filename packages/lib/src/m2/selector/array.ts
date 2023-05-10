import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { Schema } from "../schema";
import { Source, SourceArray } from "../Source";
import { Selector as BooleanSelector } from "./boolean";
import { Selector as NumberSelector } from "./number";
import { F } from "ts-toolbelt";

export type UndistributedSourceArray<T extends SourceArray> = [T] extends [
  infer U // infer here to avoid Type instantiation is excessively deep and possibly infinite. See: https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437. Avoiding infer extends to keep us below TS 4.9 compat
]
  ? U extends Source[]
    ? Selector<U>
    : never
  : never;

// TODO: docs
export type Selector<T extends SourceArray> = SelectorC<T> & {
  readonly [key: number]: UnknownSelector<T[number]>;
} & {
  length: NumberSelector<number>;
  filter(
    predicate: (
      v: UnknownSelector<T[number]>
    ) => BooleanSelector<boolean> | boolean
  ): Selector<T>;
  filter<U extends Source>(schema: Schema<U>): Selector<U[]>;
  map<U extends SelectorSource>(
    f: (
      v: UnknownSelector<T[number]>,
      i: UnknownSelector<number>
    ) => F.Narrow<U>
  ): SelectorOf<U[]>; // TODO: this should be SelectorOf<ArraySelectorSourceBranded<U[]>>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => F.Narrow<U>
  ): SelectorOf<U | T>;
};
