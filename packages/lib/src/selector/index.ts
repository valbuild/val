import * as expr from "../expr";
import { ArraySelector, newArraySelector } from "./array";
import { PrimitiveSelector } from "./primitive";
import { newObjectSelector, ObjectSelector } from "./object";
import { Selector } from "./selector";
import {
  ArrayDescriptor,
  Descriptor,
  NumberDescriptor,
  ObjectDescriptor,
  ObjectDescriptorProps,
  RecordDescriptor,
  ValueOf,
} from "../descriptor";
import { newNumberSelector, NumberSelector } from "./number";
import { newRecordSelector, RecordSelector } from "./record";

export type SelectorOf<Ctx, D extends Descriptor> = [D] extends [
  ObjectDescriptor
]
  ? ObjectSelector<Ctx, D["props"]>
  : [D] extends [ArrayDescriptor]
  ? ArraySelector<Ctx, D["item"]>
  : [D] extends [RecordDescriptor]
  ? RecordSelector<Ctx, D["item"]>
  : [D] extends [NumberDescriptor]
  ? NumberSelector<Ctx>
  : Selector<Ctx, ValueOf<D>>;

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
    case "string":
    case "boolean":
      return new PrimitiveSelector(expr) as unknown as SelectorOf<Ctx, D>;
    case "record":
      return newRecordSelector(
        expr as expr.Expr<Ctx, Record<string, unknown>>,
        desc.item
      ) as SelectorOf<Ctx, D>;
  }
}
