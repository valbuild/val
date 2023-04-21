import { FileSource } from "./Source";

export function file<F extends string>(ref: F): FileSource<F> {
  return { type: "file", ref } as FileSource<F>;
}

export function isFileRef(refObject: unknown): refObject is FileSource<string> {
  return (
    typeof refObject === "object" &&
    refObject !== null &&
    "type" in refObject &&
    refObject["type"] === "file" &&
    "ref" in refObject
  );
}
