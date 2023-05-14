import { Path, PathSegments, Val as UnknownVal } from ".";
import { JsonObject } from "../Json";

export type Val<T extends JsonObject> = Omit<
  {
    readonly [key in keyof T]: UnknownVal<T[key]>;
  },
  "val"
> & {
  readonly [Path]: PathSegments;
  readonly val: T;
};
