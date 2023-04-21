import { FileSource } from "./Source";

export function file<F extends string>(ref: F): FileSource<F> {
  return { type: "file", ref } as FileSource<F>;
}
