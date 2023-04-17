import { ValImage } from "./schema/image";
import { Source, SourcePrimitive } from "./Source";

export abstract class Descriptor<V extends Source> {
  abstract readonly optional: boolean;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validate(_value: V): never {
    throw TypeError("Not implemented");
  }
}
export abstract class NonOptionalDescriptor<
  V extends Source
> extends Descriptor<V> {
  readonly optional!: false;

  static {
    Object.defineProperty(this.prototype, "optional", {
      value: false,
      writable: false,
    });
  }
}

export class ArrayDescriptor<
  D extends Descriptor<Source>
> extends NonOptionalDescriptor<readonly ValueOf<D>[]> {
  constructor(public readonly item: D) {
    super();
  }
}

export class RecordDescriptor<
  K extends string,
  D extends Descriptor<Source>
> extends NonOptionalDescriptor<{ readonly [P in K]: ValueOf<D> }> {
  constructor(public readonly item: D) {
    super();
  }
}

export type ObjectDescriptorProps = {
  readonly [P in string]: Descriptor<Source>;
};
export class ObjectDescriptor<
  D extends ObjectDescriptorProps
> extends NonOptionalDescriptor<{ readonly [P in keyof D]: ValueOf<D[P]> }> {
  constructor(public readonly props: D) {
    super();
  }
}

export class TupleDescriptor<
  D extends readonly Descriptor<Source>[]
> extends NonOptionalDescriptor<{ [I in keyof D]: ValueOf<D[I]> }> {
  constructor(public readonly items: D) {
    super();
  }
}

export class PrimitiveDescriptor<
  V extends SourcePrimitive
> extends NonOptionalDescriptor<V> {}

export const StringDescriptor =
  new (class StringDescriptor extends PrimitiveDescriptor<string> {})();
export type StringDescriptor = typeof StringDescriptor;
export const NumberDescriptor =
  new (class NumberDescriptor extends PrimitiveDescriptor<number> {})();
export type NumberDescriptor = typeof NumberDescriptor;
export const BooleanDescriptor =
  new (class BooleanDescriptor extends PrimitiveDescriptor<boolean> {})();
export type BooleanDescriptor = typeof BooleanDescriptor;
export const NullDescriptor =
  new (class NullDescriptor extends PrimitiveDescriptor<null> {})();
export type NullDescriptor = typeof NullDescriptor;

// Assets:
export type ImageDescriptor = typeof ImageDescriptor;
export const ImageDescriptor =
  new (class ImageDescriptor extends NonOptionalDescriptor<ValImage> {})();

export class OptionalDescriptor<
  D extends NonOptionalDescriptor<Source>
> extends Descriptor<ValueOf<D> | null> {
  optional!: true;
  constructor(public readonly item: D) {
    super();
  }

  static {
    Object.defineProperty(this.prototype, "optional", {
      value: true,
      writable: false,
    });
  }
}

export type AsOptional<D extends Descriptor<Source>> =
  D extends NonOptionalDescriptor<Source>
    ? OptionalDescriptor<D>
    : D extends OptionalDescriptor<NonOptionalDescriptor<Source>>
    ? D
    : never;
export function asOptional<D extends Descriptor<Source>>(
  desc: D
): AsOptional<D> {
  if (desc instanceof OptionalDescriptor) {
    return desc as AsOptional<D>;
  } else if (desc instanceof NonOptionalDescriptor) {
    return new OptionalDescriptor(desc) as AsOptional<D>;
  }
  throw Error(
    "Invalid descriptor: Descriptor is neither optional nor required"
  );
}

export type AsRequired<D extends Descriptor<Source>> =
  D extends OptionalDescriptor<infer E>
    ? E
    : D extends NonOptionalDescriptor<Source>
    ? D
    : never;
export function asRequired<D extends Descriptor<Source>>(
  desc: D
): AsRequired<D> {
  return (
    desc instanceof OptionalDescriptor ? desc.item : desc
  ) as AsRequired<D>;
}

export type ValueOf<D extends Descriptor<Source>> = D extends Descriptor<
  infer V
>
  ? V
  : never;
