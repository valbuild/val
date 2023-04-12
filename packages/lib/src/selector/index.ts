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
  D extends Descriptor<Source>,
  Ctx
> = Descriptor<Source> extends D
  ? Selector<D, Ctx>
  : D extends ObjectDescriptor<infer E>
  ? ObjectSelector<E, Ctx>
  : D extends ArrayDescriptor<infer E>
  ? ArraySelector<E, Ctx>
  : D extends RecordDescriptor<infer K, infer E>
  ? RecordSelector<K, E, Ctx>
  : D extends OptionalDescriptor<infer E>
  ? OptionalSelector<E, Ctx>
  : D extends TupleDescriptor<infer E>
  ? TupleSelector<E, Ctx>
  : D extends NumberDescriptor
  ? NumberSelector<Ctx>
  : D extends PrimitiveDescriptor<SourcePrimitive>
  ? PrimitiveSelector<D, Ctx>
  : never;

export function getSelector<D extends Descriptor<Source>, Ctx>(
  expr: expr.Expr<Ctx, ValueOf<D>>,
  desc: D
): SelectorOf<D, Ctx> {
  if (desc instanceof ObjectDescriptor) {
    return newObjectSelector<ObjectDescriptorProps, Ctx>(
      expr as expr.Expr<Ctx, ValueOf<ObjectDescriptor<ObjectDescriptorProps>>>,
      desc.props
    ) as SelectorOf<D, Ctx>;
  } else if (desc instanceof ArrayDescriptor) {
    return newArraySelector<Descriptor<Source>, Ctx>(
      expr as expr.Expr<Ctx, ValueOf<ArrayDescriptor<Descriptor<Source>>>>,
      desc.item
    ) as SelectorOf<D, Ctx>;
  } else if (desc instanceof RecordDescriptor) {
    return newRecordSelector<string, Descriptor<Source>, Ctx>(
      expr as expr.Expr<
        Ctx,
        ValueOf<RecordDescriptor<string, Descriptor<Source>>>
      >,
      desc.item
    ) as SelectorOf<D, Ctx>;
  } else if (desc instanceof OptionalDescriptor) {
    return newOptionalSelector<NonOptionalDescriptor<Source>, Ctx>(
      expr as expr.Expr<Ctx, ValueOf<NonOptionalDescriptor<Source>>>,
      desc.item
    ) as SelectorOf<D, Ctx>;
  } else if (desc instanceof TupleDescriptor) {
    return newTupleSelector<readonly Descriptor<Source>[], Ctx>(
      expr as expr.Expr<
        Ctx,
        ValueOf<TupleDescriptor<readonly Descriptor<Source>[]>>
      >,
      desc.items
    ) as SelectorOf<D, Ctx>;
  } else if (desc === NumberDescriptor) {
    return newNumberSelector<Ctx>(
      expr as expr.Expr<Ctx, ValueOf<NumberDescriptor>>
    ) as SelectorOf<D, Ctx>;
  } else if (desc instanceof PrimitiveDescriptor) {
    return newPrimitiveSelector<PrimitiveDescriptor<SourcePrimitive>, Ctx>(
      expr as expr.Expr<Ctx, ValueOf<PrimitiveDescriptor<SourcePrimitive>>>,
      desc
    ) as SelectorOf<D, Ctx>;
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
  | Selector<Descriptor<Source>, Ctx>;

type TupleDescriptorOf<
  S extends readonly Selected<Ctx>[],
  Ctx
> = TupleDescriptor<{
  [P in keyof S]: DescriptorOf<S[P], Ctx>;
}>;

export type DescriptorOf<
  S extends Selected<unknown>,
  Ctx
> = Selected<unknown> extends S
  ? Descriptor<Source>
  : S extends Selector<infer D, unknown>
  ? D
  : S extends readonly Selected<Ctx>[]
  ? TupleDescriptorOf<S, Ctx>
  : S extends { [P in string]: Selected<Ctx> }
  ? ObjectDescriptor<{
      [P in keyof S]: DescriptorOf<S[P], Ctx>;
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
export function descriptorOf<S extends Selected<Ctx>, Ctx>(
  selected: S
): DescriptorOf<S, Ctx> {
  if (selected instanceof Selector) {
    return selected[DESC]() as DescriptorOf<S, Ctx>;
  } else if (Array.isArray(selected)) {
    const items = (selected as readonly Selected<Ctx>[]).map(descriptorOf);
    return new TupleDescriptor(items) as unknown as DescriptorOf<S, Ctx>;
  } else if (typeof selected === "string") {
    return StringDescriptor as DescriptorOf<S, Ctx>;
  } else if (typeof selected === "number") {
    return NumberDescriptor as DescriptorOf<S, Ctx>;
  } else if (typeof selected === "boolean") {
    return BooleanDescriptor as DescriptorOf<S, Ctx>;
  } else if (typeof selected === "object") {
    if (selected === null) {
      return NullDescriptor as DescriptorOf<S, Ctx>;
    }
    const props = Object.fromEntries(
      Object.entries(
        selected as {
          readonly [x: string]: Selected<Ctx>;
        }
      ).map(([prop, value]) => {
        return [prop, descriptorOf<Selected<Ctx>, Ctx>(value)];
      })
    );
    return new ObjectDescriptor(props) as DescriptorOf<S, Ctx>;
  }
  throw Error("Invalid selector result");
}

export type ExprOf<S extends Selected<Ctx>, Ctx> = expr.Expr<
  Ctx,
  ValueOf<DescriptorOf<S, Ctx>>
>;
export function exprOf<Ctx, S extends Selected<Ctx>>(
  selected: S
): ExprOf<S, Ctx> {
  if (selected instanceof Selector) {
    return selected[EXPR]() as ExprOf<S, Ctx>;
  } else if (Array.isArray(selected)) {
    return expr.arrayLiteral(selected.map(exprOf)) as unknown as ExprOf<S, Ctx>;
  } else if (
    typeof selected === "number" ||
    selected === null ||
    typeof selected === "string" ||
    typeof selected === "boolean"
  ) {
    return expr.primitiveLiteral(selected) as ExprOf<S, Ctx>;
  } else {
    const props = Object.fromEntries(
      Object.entries(selected).map(([prop, value]) => [
        prop,
        exprOf<Ctx, Selected<Ctx>>(value),
      ])
    );
    return expr.objectLiteral(props) as ExprOf<S, Ctx>;
  }
}
