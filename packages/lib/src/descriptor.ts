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

export type Descriptor =
  | ArrayDescriptor
  | RecordDescriptor
  | ObjectDescriptor
  | StringDescriptor
  | NumberDescriptor
  | BooleanDescriptor;

export type ValueOf<D> = [D] extends [ArrayDescriptor]
  ? ValueOf<D["item"]>[]
  : [D] extends [RecordDescriptor]
  ? Record<string, ValueOf<D["item"]>>
  : [D] extends [ObjectDescriptor]
  ? { [P in keyof D["props"]]: ValueOf<D["props"][P]> }
  : [D] extends [StringDescriptor]
  ? string
  : [D] extends [NumberDescriptor]
  ? number
  : [D] extends [BooleanDescriptor]
  ? boolean
  : unknown;
