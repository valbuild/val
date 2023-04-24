import { SourceObject } from "../../Source";
import { Selector as UnknownSelector, SelectorC } from ".";

declare const brand: unique symbol;
export type Selector<T extends SourceObject> = SelectorC<T> & {
  readonly [key in keyof T]: UnknownSelector<T[key]>;
} & {
  [brand]: "ObjectSelector";
};
