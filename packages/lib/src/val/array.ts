import { Source } from "../Source";
import { Val as UnknownVal } from ".";

export type Val<T extends readonly Source[]> = Omit<
  {
    readonly [key in keyof T]: UnknownVal<T[key]>;
  },
  "valSrc" | "val"
> & {
  readonly valSrc: string;
  readonly val: T;
};
