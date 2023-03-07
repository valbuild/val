export type CompositeVal<T> = Omit<
  {
    [key in keyof T]: ReactVal<T[key]>;
  },
  "valId" | "val"
> & {
  readonly valId: string;
  readonly val: T;
};
export type PrimitiveVal<T> = {
  valId: string;
  val: T;
};
export type ReactVal<T> = T extends object ? CompositeVal<T> : PrimitiveVal<T>;
