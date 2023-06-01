import { SourcePath } from ".";
import { JsonPrimitive } from "../Json";
import { Path } from "../selector";

export type Val<T extends JsonPrimitive> = {
  [Path]: SourcePath | undefined;
  val: T;
};
