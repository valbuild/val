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

export type Descriptor = ArrayDescriptor | ObjectDescriptor | StringDescriptor;
