import { SourcePrimitive } from "../Source";

export type Val<T extends SourcePrimitive> = {
  valPath: string;
  val: T;
};
