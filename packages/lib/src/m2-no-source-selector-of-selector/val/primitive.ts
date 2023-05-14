import { Path, PathSegments } from ".";
import { JsonPrimitive } from "../Json";

export type Val<T extends JsonPrimitive> = {
  readonly [Path]: PathSegments;
  readonly val: T;
};
