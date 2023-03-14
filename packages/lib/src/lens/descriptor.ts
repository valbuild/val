export type ArrayDescriptor = {
  readonly type: "array";
  readonly item: Descriptor;
};

export type I18nDescriptor = {
  readonly type: "i18n";
  readonly desc: Descriptor;
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
  | I18nDescriptor
  | ObjectDescriptor
  | StringDescriptor
  | BooleanDescriptor;

export type ValueOf<D> = D extends ArrayDescriptor
  ? ValueOf<D["item"]>[]
  : D extends I18nDescriptor
  ? ValueOf<D["desc"]>
  : D extends ObjectDescriptor
  ? { [P in keyof D["props"]]: ValueOf<D["props"][P]> }
  : D extends StringDescriptor
  ? string
  : D extends BooleanDescriptor
  ? boolean
  : unknown;
