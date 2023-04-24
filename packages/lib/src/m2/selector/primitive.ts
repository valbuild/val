import { SelectorC } from ".";
import { SourcePrimitive } from "../../Source";

declare const brand: unique symbol;
export type Selector<T extends SourcePrimitive> = SelectorC<T> & {
  eq: (other: T) => Selector<boolean>;
  [brand]: "PrimitiveSelector";
};
