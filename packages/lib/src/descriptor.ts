export type ArrayDescriptor = {
  readonly type: "array";
  readonly item: Descriptor;
};

export type DetailedArrayDescriptor<D extends Descriptor> = {
  readonly type: "array";
  readonly item: D;
};

export type RecordDescriptor = {
  readonly type: "record";
  readonly item: Descriptor;
};

export type DetailedRecordDescriptor<D extends Descriptor> = {
  readonly type: "record";
  readonly item: D;
};

export type ObjectDescriptorProps = {
  [P in string]: Descriptor;
};

export type ObjectDescriptor = {
  readonly type: "object";
  readonly props: ObjectDescriptorProps;
};

export type DetailedObjectDescriptor<D extends ObjectDescriptorProps> = {
  readonly type: "object";
  readonly props: D;
};

export type OptionalDescriptor = {
  readonly type: "optional";
  readonly item: NNDescriptor;
};

export type DetailedOptionalDescriptor<D extends NNDescriptor> = {
  readonly type: "optional";
  readonly item: D;
};

export type AsOptional<D extends Descriptor> = [D] extends [OptionalDescriptor]
  ? D
  : [D] extends [NNDescriptor]
  ? DetailedOptionalDescriptor<D>
  : never;
export function asOptional<D extends Descriptor>(desc: D): AsOptional<D> {
  return (
    desc.type === "optional"
      ? desc
      : {
          type: "optional",
          item: desc,
        }
  ) as AsOptional<D>;
}

export type AsRequired<D extends Descriptor> = [D] extends [OptionalDescriptor]
  ? D["item"]
  : [D] extends [NNDescriptor]
  ? D
  : never;
export function asRequired<D extends Descriptor>(desc: D): AsRequired<D> {
  return (desc.type === "optional" ? desc.item : desc) as AsRequired<D>;
}

export type StringDescriptor = {
  readonly type: "string";
};
export const StringDescriptor: StringDescriptor = Object.freeze({
  type: "string",
});

export type NumberDescriptor = {
  readonly type: "number";
};
export const NumberDescriptor: NumberDescriptor = Object.freeze({
  type: "number",
});

export type BooleanDescriptor = {
  readonly type: "boolean";
};
export const BooleanDescriptor: BooleanDescriptor = Object.freeze({
  type: "boolean",
});

export type NNDescriptor =
  | ArrayDescriptor
  | RecordDescriptor
  | ObjectDescriptor
  | StringDescriptor
  | NumberDescriptor
  | BooleanDescriptor;

export type Descriptor = NNDescriptor | OptionalDescriptor;

export type ValueOf<D> = [D] extends [ArrayDescriptor]
  ? ValueOf<D["item"]>[]
  : [D] extends [RecordDescriptor]
  ? Record<string, ValueOf<D["item"]>>
  : [D] extends [ObjectDescriptor]
  ? { [P in keyof D["props"]]: ValueOf<D["props"][P]> }
  : [D] extends [OptionalDescriptor]
  ? ValueOf<D["item"]> | null
  : [D] extends [StringDescriptor]
  ? string
  : [D] extends [NumberDescriptor]
  ? number
  : [D] extends [BooleanDescriptor]
  ? boolean
  : unknown;
