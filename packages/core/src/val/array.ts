import { SourcePath, Val as UnknownVal } from ".";
import { JsonArray } from "../Json";
import { Path } from "../selector/index";

export type Val<T extends JsonArray> = {
  readonly [key in keyof T]: UnknownVal<T[key]>;
} & {
  readonly [Path]: SourcePath | undefined;
  readonly val: T;
};
