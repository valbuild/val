import { SourceObject } from "../Source";
import { Val as UnknownVal } from ".";

export type Val<T extends SourceObject> = Omit<
  {
    readonly [key in keyof T]: UnknownVal<T[key]>;
  },
  "valPath" | "val"
> & {
  readonly valPath: string;
  readonly val: T;
};
