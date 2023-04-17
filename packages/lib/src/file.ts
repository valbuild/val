import { FileSource } from "./Source";

export function file<F extends string>(ref: F): FileSource<F> {
  return { ref } as FileSource<F>;
}
