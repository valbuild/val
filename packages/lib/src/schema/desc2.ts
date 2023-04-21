import {
  ArrayDescriptor,
  Descriptor,
  LiteralDescriptor,
  NullDescriptor,
  NumberDescriptor,
  ObjectDescriptor,
  StringDescriptor,
  UnionDescriptor,
} from "../descriptor2";
import { Source } from "../Source";
import { ArraySchema } from "./array";
import { I18nSchema } from "./i18n";
import { NumberSchema } from "./number";
import { ObjectSchema, SchemaObject } from "./object";
import { LocalOf, Schema } from "./Schema";
import { StringSchema } from "./string";
import { LiteralSchema, TaggedUnionSchema } from "./taggedUnion";

export type MaybeOptDesc<D extends Descriptor<Source>, Opt extends boolean> =
  | (Opt extends true ? D | Descriptor<null> : never)
  | (Opt extends false ? D : never);

export function maybeOptDesc<D extends Descriptor<Source>, Opt extends boolean>(
  desc: D,
  opt: Opt
): MaybeOptDesc<D, Opt> {
  return (
    opt
      ? UnionDescriptor.create<D | null>([
          desc as Descriptor<D | null>,
          NullDescriptor,
        ])
      : desc
  ) as MaybeOptDesc<D, Opt>;
}

export type LocalDescriptorOf<S extends Schema<never, Source>> = Descriptor<
  LocalOf<S>
>;

export function localDescriptorOf<S extends Schema<never, Source>>(
  s: S
): LocalDescriptorOf<S> {
  if (s instanceof ArraySchema) {
    return maybeOptDesc(
      ArrayDescriptor.create(localDescriptorOf(s.item) as any),
      s.opt
    ) as LocalDescriptorOf<S>;
  } else if (s instanceof I18nSchema) {
    return maybeOptDesc(
      localDescriptorOf(s.schema),
      s.opt
    ) as LocalDescriptorOf<S>;
  } else if (s instanceof ObjectSchema) {
    const entries = Object.entries(s.props as SchemaObject).map(
      ([prop, s]) => [prop, localDescriptorOf(s)] as const
    );
    return maybeOptDesc(
      ObjectDescriptor.create(Object.fromEntries(entries)),
      s.opt
    ) as LocalDescriptorOf<S>;
  } else if (s instanceof StringSchema) {
    return maybeOptDesc(StringDescriptor, s.opt) as LocalDescriptorOf<S>;
  } else if (s instanceof NumberSchema) {
    return maybeOptDesc(NumberDescriptor, s.opt) as LocalDescriptorOf<S>;
  } else if (s instanceof LiteralSchema) {
    return maybeOptDesc(
      LiteralDescriptor.create(s.value) as any,
      s.opt
    ) as LocalDescriptorOf<S>;
  } else if (s instanceof TaggedUnionSchema) {
    return maybeOptDesc(
      UnionDescriptor.create([...s.schemas.values()].map(localDescriptorOf)),
      s.opt
    ) as LocalDescriptorOf<S>;
  }
  throw Error("Unsupported schema");
}
