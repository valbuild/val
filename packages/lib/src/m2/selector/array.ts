import { Source } from "../../Source";
import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SourceObject,
} from ".";
import { Selector as ObjectSelector } from "./object";

declare const brand: unique symbol;
export type Selector<T extends readonly Source[]> = SelectorC<T> & {
  readonly [key in keyof T & number]: UnknownSelector<T[key]>;
} & {
  [brand]: "ArraySelector";
  length: UnknownSelector<T["length"]>;
  filter(
    predicate: (v: UnknownSelector<T[number]>) => SelectorOf<boolean>
  ): SelectorOf<T>;
  map<U>(f: (v: UnknownSelector<T[number]>) => U): SelectorOf<U[]>;
};
