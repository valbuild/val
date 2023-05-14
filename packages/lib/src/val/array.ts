import { Val as UnknownVal } from ".";
import { JsonArray } from "../Json";

export type Val<T extends JsonArray> = {
  readonly [key in keyof T]: UnknownVal<T[key]>;
} & {
  readonly valPath: string;
  readonly val: T;
};
