import { Path, PathSegments, Val as UnknownVal } from ".";
import { JsonArray } from "../Json";

export type Val<T extends JsonArray> = {
  readonly [key in keyof T]: UnknownVal<T[key]>;
} & {
  readonly [Path]: PathSegments;
  readonly val: T;
};
