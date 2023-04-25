import { SelectorC, SourcePrimitive } from ".";

declare const brand: unique symbol;
export type Selector<T extends SourcePrimitive> = SelectorC<T> & {
  eq(other: SourcePrimitive): Selector<boolean>;
  readonly [brand]: "PrimitiveSelector";
};
