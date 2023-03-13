export type ArrayDescriptor = {
  readonly type: "array";
  readonly item: Descriptor;
};

export type ObjectDescriptor = {
  readonly type: "object";
  readonly props: { [P in string]: Descriptor };
};

export type StringDescriptor = {
  readonly type: "string";
};
export const StringDescriptor: StringDescriptor = Object.freeze({
  type: "string",
});

export type BooleanDescriptor = {
  readonly type: "boolean";
};
export const BooleanDescriptor: BooleanDescriptor = Object.freeze({
  type: "boolean",
});

export type Descriptor =
  | ArrayDescriptor
  | ObjectDescriptor
  | StringDescriptor
  | BooleanDescriptor;

export type ValueOf<D> = D extends ArrayDescriptor
  ? ValueOf<D["item"]>[]
  : D extends ObjectDescriptor
  ? { [P in keyof D["props"]]: ValueOf<D["props"][P]> }
  : D extends StringDescriptor
  ? string
  : D extends BooleanDescriptor
  ? boolean
  : unknown;

export type DescriptorOf<V> = V extends (infer T)[]
  ? { type: "array"; item: DescriptorOf<T> }
  : V extends object
  ? { type: "object"; props: { [P in keyof V]: DescriptorOf<V[P]> } }
  : V extends string
  ? { type: "string" }
  : V extends boolean
  ? { type: "boolean" }
  : never;
