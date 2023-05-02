import { SourcePrimitive } from "../Source";

export type Val<T extends SourcePrimitive> = {
  valSrc: string;
  val: T;
};
