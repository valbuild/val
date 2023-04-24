import { SelectorC, SourcePrimitive } from ".";

declare const brand: unique symbol;
export type Selector<T extends SourcePrimitive> = SelectorC<T> & {
  eq(other: T): Selector<boolean>;
  readonly [brand]: "PrimitiveSelector";
};

{
  const a = "" as unknown as Selector<string | number>;
  a.eq(1);
}
