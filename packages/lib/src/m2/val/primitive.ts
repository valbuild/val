import { JsonPrimitive } from "../Json";

export type Val<T extends JsonPrimitive> = {
  valPath: string;
  val: T;
};
