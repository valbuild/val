import { Val as UnknownVal } from ".";
import { JsonObject } from "../Json";

export type Val<T extends JsonObject> = Omit<
  {
    readonly [key in keyof T]: UnknownVal<T[key]>;
  },
  "valPath" | "val"
> & {
  readonly valPath: string;
  readonly val: T;
};
