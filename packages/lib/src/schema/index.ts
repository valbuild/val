import {
  ArrayDescriptor,
  AsOptional,
  asOptional,
  Descriptor,
  ObjectDescriptor,
  StringDescriptor,
  NumberDescriptor,
  RecordDescriptor,
} from "../descriptor";
import { Source } from "../Source";
import { ArraySchema } from "./array";
import { I18nSchema } from "./i18n";
import { NumberSchema } from "./number";
import { ObjectSchema, SchemaObject } from "./object";
import { Schema } from "./Schema";
import { StringSchema } from "./string";

export type MaybeOptDesc<D extends Descriptor<Source>, Opt extends boolean> =
  | (Opt extends true ? AsOptional<D> : never)
  | (Opt extends false ? D : never);

export function maybeOptDesc<D extends Descriptor<Source>, Opt extends boolean>(
  desc: D,
  opt: Opt
): MaybeOptDesc<D, Opt> {
  return (opt ? asOptional(desc) : desc) as MaybeOptDesc<D, Opt>;
}

export type LocalDescriptorOf<S extends Schema<never, Source>> = Schema<
  Source,
  Source
> extends S
  ? Descriptor<Source>
  : S extends ArraySchema<infer T, infer Opt>
  ? MaybeOptDesc<ArrayDescriptor<LocalDescriptorOf<T>>, Opt>
  : S extends I18nSchema<infer T, infer Opt>
  ? MaybeOptDesc<LocalDescriptorOf<T>, Opt>
  : S extends ObjectSchema<infer T, infer Opt>
  ? MaybeOptDesc<
      ObjectDescriptor<{ [P in keyof T]: LocalDescriptorOf<T[P]> }>,
      Opt
    >
  : S extends StringSchema<infer Opt>
  ? MaybeOptDesc<StringDescriptor, Opt>
  : S extends NumberSchema<infer Opt>
  ? MaybeOptDesc<NumberDescriptor, Opt>
  : MaybeOptDesc<Descriptor<Source>, boolean>;

export type RawDescriptorOf<S extends Schema<never, Source>> = Schema<
  Source,
  Source
> extends S
  ? Descriptor<Source>
  : S extends ArraySchema<infer T, infer Opt>
  ? MaybeOptDesc<ArrayDescriptor<RawDescriptorOf<T>>, Opt>
  : S extends I18nSchema<infer T, infer Opt>
  ? MaybeOptDesc<RawDescriptorOf<T>, Opt>
  : S extends ObjectSchema<infer T, infer Opt>
  ? MaybeOptDesc<
      ObjectDescriptor<{ [P in keyof T]: RawDescriptorOf<T[P]> }>,
      Opt
    >
  : S extends StringSchema<infer Opt>
  ? MaybeOptDesc<StringDescriptor, Opt>
  : S extends NumberSchema<infer Opt>
  ? MaybeOptDesc<NumberDescriptor, Opt>
  : MaybeOptDesc<Descriptor<Source>, boolean>;

export function localDescriptorOf<S extends Schema<never, Source>>(
  s: S
): LocalDescriptorOf<S> {
  if (s instanceof ArraySchema) {
    return maybeOptDesc(
      new ArrayDescriptor(localDescriptorOf(s.item)),
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
      new ObjectDescriptor(Object.fromEntries(entries)),
      s.opt
    ) as LocalDescriptorOf<S>;
  } else if (s instanceof StringSchema) {
    return maybeOptDesc(StringDescriptor, s.opt) as LocalDescriptorOf<S>;
  } else if (s instanceof NumberSchema) {
    return maybeOptDesc(NumberDescriptor, s.opt) as LocalDescriptorOf<S>;
  }
  throw Error("Unsupported schema");
}
export function rawDescriptorOf<S extends Schema<never, Source>>(
  s: S
): RawDescriptorOf<S> {
  if (s instanceof ArraySchema) {
    return maybeOptDesc(
      new ArrayDescriptor(rawDescriptorOf(s.item)),
      s.opt
    ) as RawDescriptorOf<S>;
  } else if (s instanceof I18nSchema) {
    return maybeOptDesc(
      new RecordDescriptor(rawDescriptorOf(s.schema)),
      s.opt
    ) as unknown as RawDescriptorOf<S>;
  } else if (s instanceof ObjectSchema) {
    const entries = Object.entries(s.props as SchemaObject).map(
      ([prop, s]) => [prop, rawDescriptorOf(s)] as const
    );
    return maybeOptDesc(
      new ObjectDescriptor(Object.fromEntries(entries)),
      s.opt
    ) as RawDescriptorOf<S>;
  } else if (s instanceof StringSchema) {
    return maybeOptDesc(StringDescriptor, s.opt) as RawDescriptorOf<S>;
  } else if (s instanceof NumberSchema) {
    return maybeOptDesc(NumberDescriptor, s.opt) as RawDescriptorOf<S>;
  }
  throw Error("Unsupported schema");
}
