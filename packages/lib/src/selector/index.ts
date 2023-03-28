import * as expr from "../expr";
import { ArraySelector, newArraySelector } from "./array";
import { PrimitiveSelector } from "./primitive";
import { newObjectSelector, ObjectSelector, ValuesOf } from "./object";
import { DESC, EXPR, Selector } from "./selector";
import {
  ArrayDescriptor,
  Descriptor,
  DetailedArrayDescriptor,
  DetailedObjectDescriptor,
  DetailedOptionalDescriptor,
  DetailedRecordDescriptor,
  NumberDescriptor,
  ObjectDescriptor,
  ObjectDescriptorProps,
  OptionalDescriptor,
  RecordDescriptor,
  ValueOf,
} from "../descriptor";
import { newNumberSelector, NumberSelector } from "./number";
import { newRecordSelector, RecordSelector } from "./record";
import { newOptionalSelector, OptionalSelector } from "./optional";

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
  : [D] extends [NumberDescriptor]
  ? NumberSelector<Ctx>
  : PrimitiveSelector<Ctx, D>;

export function getSelector<Ctx, D extends Descriptor>(
  expr: expr.Expr<Ctx, ValueOf<D>>,
  desc: D
): SelectorOf<Ctx, D> {
  switch (desc.type) {
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

// TODO: Expand to include objects and arrays
export type Selected<Ctx> = Selector<Ctx, unknown>;

export type DescriptorOf<S extends Selected<unknown>> = [S] extends [
  ObjectSelector<unknown, infer D>
]
  ? DetailedObjectDescriptor<D>
  : [S] extends [ArraySelector<unknown, infer D>]
  ? DetailedArrayDescriptor<D>
  : [S] extends [RecordSelector<unknown, infer D>]
  ? DetailedRecordDescriptor<D>
  : [S] extends [OptionalSelector<unknown, infer D>]
  ? DetailedOptionalDescriptor<D>
  : [S] extends [PrimitiveSelector<unknown, infer D>]
  ? D
  : never;
export function descriptorOf<Ctx, S extends Selected<Ctx>>(
  selector: S
): DescriptorOf<S> {
  return selector[DESC]() as DescriptorOf<S>;
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
  : never;
export function exprOf<Ctx, S extends Selector<Ctx, unknown>>(selector: S) {
  return selector[EXPR]() as ExprOf<Ctx, S>;
}
