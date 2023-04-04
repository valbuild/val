import * as expr from "../expr";
import { ArraySelector, newArraySelector } from "./array";
import { newObjectSelector, ObjectSelector } from "./object";
import { DESC, EXPR, Selector } from "./selector";
import {
  ArrayDescriptor,
  Descriptor,
  NumberDescriptor,
  ObjectDescriptor,
  ObjectDescriptorProps,
  OptionalDescriptor,
  RecordDescriptor,
  TupleDescriptor,
  StringDescriptor,
  BooleanDescriptor,
  NullDescriptor,
  ValueOf,
  PrimitiveDescriptor,
  NonOptionalDescriptor,
} from "../descriptor";
import { newNumberSelector, NumberSelector } from "./number";
import { newRecordSelector, RecordSelector } from "./record";
import { newOptionalSelector, OptionalSelector } from "./optional";
import { newTupleSelector, TupleSelector } from "./tuple";
import { newPrimitiveSelector, PrimitiveSelector } from "./primitive";
import { Source, SourcePrimitive } from "../Source";

export type SelectorOf<
  Ctx,
  D extends Descriptor<Source>
> = Descriptor<Source> extends D
  ? Selector<Ctx, D>
  : D extends ObjectDescriptor<infer E>
  ? ObjectSelector<Ctx, E>
  : D extends ArrayDescriptor<infer E>
  ? ArraySelector<Ctx, E>
  : D extends RecordDescriptor<infer K, infer E>
  ? RecordSelector<Ctx, K, E>
  : D extends OptionalDescriptor<infer E>
  ? OptionalSelector<Ctx, E>
  : D extends TupleDescriptor<infer E>
  ? TupleSelector<Ctx, E>
  : D extends NumberDescriptor
  ? NumberSelector<Ctx>
  : D extends PrimitiveDescriptor<SourcePrimitive>
  ? PrimitiveSelector<Ctx, D>
  : never;

export function getSelector<Ctx, D extends Descriptor<Source>>(
  expr: expr.Expr<Ctx, ValueOf<D>>,
  desc: D
): SelectorOf<Ctx, D> {
  if (desc instanceof ObjectDescriptor) {
    return newObjectSelector<Ctx, ObjectDescriptorProps>(
      expr as expr.Expr<Ctx, ValueOf<ObjectDescriptor<ObjectDescriptorProps>>>,
      desc.props
    ) as SelectorOf<Ctx, D>;
  } else if (desc instanceof ArrayDescriptor) {
    return newArraySelector<Ctx, Descriptor<Source>>(
      expr as expr.Expr<Ctx, ValueOf<ArrayDescriptor<Descriptor<Source>>>>,
      desc.item
    ) as SelectorOf<Ctx, D>;
  } else if (desc instanceof RecordDescriptor) {
    return newRecordSelector<Ctx, string, Descriptor<Source>>(
      expr as expr.Expr<
        Ctx,
        ValueOf<RecordDescriptor<string, Descriptor<Source>>>
      >,
      desc.item
    ) as SelectorOf<Ctx, D>;
  } else if (desc instanceof OptionalDescriptor) {
    return newOptionalSelector<Ctx, NonOptionalDescriptor<Source>>(
      expr as expr.Expr<Ctx, ValueOf<NonOptionalDescriptor<Source>>>,
      desc.item
    ) as SelectorOf<Ctx, D>;
  } else if (desc instanceof TupleDescriptor) {
    return newTupleSelector<Ctx, readonly Descriptor<Source>[]>(
      expr as expr.Expr<
        Ctx,
        ValueOf<TupleDescriptor<readonly Descriptor<Source>[]>>
      >,
      desc.items
    ) as SelectorOf<Ctx, D>;
  } else if (desc === NumberDescriptor) {
    return newNumberSelector<Ctx>(
      expr as expr.Expr<Ctx, ValueOf<NumberDescriptor>>
    ) as SelectorOf<Ctx, D>;
  } else if (desc instanceof PrimitiveDescriptor) {
    return newPrimitiveSelector<Ctx, PrimitiveDescriptor<SourcePrimitive>>(
      expr as expr.Expr<Ctx, ValueOf<PrimitiveDescriptor<SourcePrimitive>>>,
      desc
    ) as SelectorOf<Ctx, D>;
  }

  throw Error("Unknown descriptor type");
}

export type Selected<Ctx> =
  | string
  | number
  | boolean
  | null
  | { readonly [P in string]: Selected<Ctx> }
  | readonly Selected<Ctx>[]
  | Selector<Ctx, Descriptor<Source>>;

type TupleDescriptorOf<
  Ctx,
  S extends readonly Selected<Ctx>[]
> = TupleDescriptor<{
  [P in keyof S]: DescriptorOf<Ctx, S[P]>;
}>;

export type DescriptorOf<
  Ctx,
  S extends Selected<unknown>
> = Selected<unknown> extends S
  ? Descriptor<Source>
  : S extends Selector<unknown, infer D>
  ? D
  : S extends readonly Selected<Ctx>[]
  ? TupleDescriptorOf<Ctx, S>
  : S extends { [P in string]: Selected<Ctx> }
  ? ObjectDescriptor<{
      [P in keyof S]: DescriptorOf<Ctx, S[P]>;
    }>
  : S extends string
  ? StringDescriptor
  : S extends boolean
  ? BooleanDescriptor
  : S extends number
  ? NumberDescriptor
  : S extends null
  ? NullDescriptor
  : never;
export function descriptorOf<Ctx, S extends Selected<Ctx>>(
  selected: S
): DescriptorOf<Ctx, S> {
  if (selected instanceof Selector) {
    return selected[DESC]() as DescriptorOf<Ctx, S>;
  } else if (Array.isArray(selected)) {
    const items = (selected as readonly Selected<Ctx>[]).map(descriptorOf);
    return new TupleDescriptor(items) as unknown as DescriptorOf<Ctx, S>;
  } else if (typeof selected === "string") {
    return StringDescriptor as DescriptorOf<Ctx, S>;
  } else if (typeof selected === "number") {
    return NumberDescriptor as DescriptorOf<Ctx, S>;
  } else if (typeof selected === "boolean") {
    return BooleanDescriptor as DescriptorOf<Ctx, S>;
  } else if (typeof selected === "object") {
    if (selected === null) {
      return NullDescriptor as DescriptorOf<Ctx, S>;
    }
    const props = Object.fromEntries(
      Object.entries(
        selected as {
          readonly [x: string]: Selected<Ctx>;
        }
      ).map(([prop, value]) => {
        return [prop, descriptorOf<Ctx, Selected<Ctx>>(value)];
      })
    );
    return new ObjectDescriptor(props) as DescriptorOf<Ctx, S>;
  }
  throw Error("Invalid selector result");
}

export type ExprOf<Ctx, S extends Selected<Ctx>> = expr.Expr<
  Ctx,
  ValueOf<DescriptorOf<Ctx, S>>
>;
export function exprOf<Ctx, S extends Selected<Ctx>>(
  selected: S
): ExprOf<Ctx, S> {
  if (selected instanceof Selector) {
    return selected[EXPR]() as ExprOf<Ctx, S>;
  } else if (Array.isArray(selected)) {
    return expr.arrayLiteral(selected.map(exprOf)) as unknown as ExprOf<Ctx, S>;
  } else if (
    typeof selected === "number" ||
    selected === null ||
    typeof selected === "string" ||
    typeof selected === "boolean"
  ) {
    return expr.primitiveLiteral(selected) as ExprOf<Ctx, S>;
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
