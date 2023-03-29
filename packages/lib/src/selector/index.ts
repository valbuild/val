import * as expr from "../expr";
import { ArraySelector, newArraySelector } from "./array";
import { newObjectSelector, ObjectSelector, ValuesOf } from "./object";
import { DESC, EXPR, Selector } from "./selector";
import {
  ArrayDescriptor,
  Descriptor,
  DetailedArrayDescriptor,
  DetailedObjectDescriptor,
  DetailedOptionalDescriptor,
  DetailedRecordDescriptor,
  DetailedTupleDescriptor,
  NumberDescriptor,
  ObjectDescriptor,
  ObjectDescriptorProps,
  OptionalDescriptor,
  RecordDescriptor,
  TupleDescriptor,
  ValueOf,
} from "../descriptor";
import { newNumberSelector, NumberSelector } from "./number";
import { newRecordSelector, RecordSelector } from "./record";
import { newOptionalSelector, OptionalSelector } from "./optional";
import { newTupleSelector, TupleSelector } from "./tuple";
import { PrimitiveSelector } from "./primitive";

export type SelectorOf<Ctx, D extends Descriptor> = [D] extends [
  ObjectDescriptor
]
  ? ObjectSelector<Ctx, D["props"]>
  : [D] extends [ArrayDescriptor]
  ? ArraySelector<Ctx, D["item"]>
  : [D] extends [RecordDescriptor]
  ? RecordSelector<Ctx, D["item"]>
  : [D] extends [OptionalDescriptor]
  ? OptionalSelector<Ctx, D["item"]>
  : [D] extends [TupleDescriptor]
  ? TupleSelector<Ctx, D["items"]>
  : [D] extends [NumberDescriptor]
  ? NumberSelector<Ctx>
  : PrimitiveSelector<Ctx, D>;

export function getSelector<Ctx, D extends Descriptor>(
  expr: expr.Expr<Ctx, ValueOf<D>>,
  desc: D
): SelectorOf<Ctx, D> {
  switch (desc.type) {
    case "tuple":
      return newTupleSelector<Ctx, readonly Descriptor[]>(
        expr as expr.Expr<Ctx, ValueOf<TupleDescriptor>>,
        desc.items
      ) as unknown as SelectorOf<Ctx, D>;
    case "array":
      return newArraySelector<Ctx, Descriptor>(
        expr as expr.Expr<Ctx, ValueOf<Descriptor>[]>,
        desc.item
      ) as SelectorOf<Ctx, D>;
    case "number":
      return newNumberSelector(expr as expr.Expr<Ctx, number>) as SelectorOf<
        Ctx,
        D
      >;
    case "object":
      return newObjectSelector<Ctx, ObjectDescriptorProps>(
        expr as expr.Expr<Ctx, ValueOf<ObjectDescriptor>>,
        desc.props
      ) as unknown as SelectorOf<Ctx, D>;
    case "optional":
      return newOptionalSelector(
        expr as expr.Expr<Ctx, ValueOf<OptionalDescriptor>>,
        desc.item
      ) as SelectorOf<Ctx, D>;
    case "string":
    case "boolean":
      return new PrimitiveSelector(expr, desc) as unknown as SelectorOf<Ctx, D>;
    case "record":
      return newRecordSelector(
        expr as expr.Expr<Ctx, Record<string, unknown>>,
        desc.item
      ) as SelectorOf<Ctx, D>;
  }
}

export type Selected<Ctx> =
  | { readonly [P in string]: Selected<Ctx> }
  | readonly Selected<Ctx>[]
  | Selector<Ctx, unknown>;

type TupleDescriptorOf<
  Ctx,
  S extends readonly Selected<Ctx>[]
> = DetailedTupleDescriptor<{
  [P in keyof S]: DescriptorOf<Ctx, S[P]>;
}> &
  Descriptor;

export type DescriptorOf<Ctx, S extends Selected<unknown>> = [S] extends [
  ObjectSelector<unknown, infer D>
]
  ? DetailedObjectDescriptor<D>
  : [S] extends [ArraySelector<Ctx, infer D>]
  ? DetailedArrayDescriptor<D>
  : [S] extends [RecordSelector<Ctx, infer D>]
  ? DetailedRecordDescriptor<D>
  : [S] extends [OptionalSelector<Ctx, infer D>]
  ? DetailedOptionalDescriptor<D>
  : [S] extends [PrimitiveSelector<Ctx, infer D>]
  ? D
  : [S] extends [readonly Selected<Ctx>[]]
  ? TupleDescriptorOf<Ctx, S>
  : [S] extends [{ [P in string]: Selected<Ctx> }]
  ? DetailedObjectDescriptor<{
      [P in keyof S]: DescriptorOf<Ctx, S[P]>;
    }>
  : Descriptor;
export function descriptorOf<Ctx, S extends Selected<Ctx>>(
  selected: S
): DescriptorOf<Ctx, S> {
  if (selected instanceof Selector) {
    return selected[DESC]() as DescriptorOf<Ctx, S>;
  } else if (Array.isArray(selected)) {
    const items = (selected as readonly Selected<Ctx>[]).map(descriptorOf);
    return {
      type: "tuple",
      items,
    } as unknown as DescriptorOf<Ctx, S>;
  } else {
    const props = Object.fromEntries(
      Object.entries(
        selected as {
          readonly [x: string]: Selected<Ctx>;
        }
      ).map(([prop, value]) => {
        return [prop, descriptorOf<Ctx, Selected<Ctx>>(value)];
      })
    );
    return {
      type: "object",
      props,
    } as DescriptorOf<Ctx, S>;
  }
}

export type ExprOf<Ctx, S extends Selected<Ctx>> = [S] extends [
  ObjectSelector<Ctx, infer D>
]
  ? expr.Expr<Ctx, ValuesOf<D>>
  : [S] extends [ArraySelector<Ctx, infer D>]
  ? expr.Expr<Ctx, ValueOf<D>[]>
  : [S] extends [RecordSelector<Ctx, infer D>]
  ? expr.Expr<Ctx, Record<string, ValueOf<D>>>
  : [S] extends [OptionalSelector<Ctx, infer D>]
  ? expr.Expr<Ctx, ValueOf<D> | null>
  : [S] extends [PrimitiveSelector<Ctx, infer D>]
  ? expr.Expr<Ctx, ValueOf<D>>
  : [S] extends [readonly Selected<Ctx>[]]
  ? expr.Expr<Ctx, ValueOf<DescriptorOf<Ctx, S>>>
  : [S] extends [{ [P in string]: Selected<Ctx> }]
  ? expr.Expr<Ctx, ValueOf<DescriptorOf<Ctx, S>>>
  : expr.Expr<Ctx, unknown>;
export function exprOf<Ctx, S extends Selected<Ctx>>(
  selected: S
): ExprOf<Ctx, S> {
  if (selected instanceof Selector) {
    return selected[EXPR]() as ExprOf<Ctx, S>;
  } else if (Array.isArray(selected)) {
    return expr.arrayLiteral(selected.map(exprOf)) as ExprOf<Ctx, S>;
  } else {
    const props = Object.fromEntries(
      Object.entries(selected).map(([prop, value]) => [
        prop,
        exprOf<Ctx, Selected<Ctx>>(value),
      ])
    );
    return expr.objectLiteral(props) as ExprOf<Ctx, S>;
  }
}

type SelectedsOf<Ctx, D extends readonly Descriptor[]> = {
  readonly [I in keyof D]: SelectedOf<Ctx, D[I]>;
};

export type SelectedOf<Ctx, D extends Descriptor> = [D] extends [
  ObjectDescriptor
]
  ?
      | ObjectSelector<Ctx, D["props"]>
      | { readonly [P in keyof D["props"]]: SelectedOf<Ctx, D["props"][P]> }
  : [D] extends [ArrayDescriptor]
  ? ArraySelector<Ctx, D["item"]> | readonly SelectedOf<Ctx, D["item"]>[]
  : [D] extends [RecordDescriptor]
  ? RecordSelector<Ctx, D["item"]> | Record<string, SelectedOf<Ctx, D["item"]>>
  : [D] extends [OptionalDescriptor]
  ? OptionalSelector<Ctx, D["item"]>
  : [D] extends [TupleDescriptor]
  ? TupleSelector<Ctx, D["items"]> | SelectedsOf<Ctx, D["items"]>
  : [D] extends [NumberDescriptor]
  ? NumberSelector<Ctx>
  : Selector<Ctx, D>;
