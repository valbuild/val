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

// TODO: docs
export type Selector<T extends SourceTuple> = SelectorC<T> & {
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
  ): SelectorOf<U | T>;
} & {
  readonly [key in keyof T]: UnknownSelector<T[key]>;
};
