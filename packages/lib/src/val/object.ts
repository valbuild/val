import { SourceObject, AsReadonlySource } from "../Source";
import { Val as UnknownVal } from ".";

export type Val<T extends SourceObject> = Omit<
  {
    readonly [key in keyof T]: UnknownVal<T[key]>;
  },
  "valSrc" | "val"
> & {
  readonly valSrc: string;
  readonly val: AsReadonlySource<T>;
};
