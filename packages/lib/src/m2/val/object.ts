import { Val as UnknownVal } from ".";
import { JsonObject } from "../Json";
import { Path } from "../selector";

export type Val<T extends JsonObject> = Omit<
  {
    readonly [key in keyof T]: UnknownVal<T[key]>;
  },
  "valPath" | "val"
> & {
  readonly [Path]: string;
  readonly val: T;
};
