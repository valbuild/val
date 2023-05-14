import { FileSource, FILE_REF_PROP } from "./Source";

export function file<F extends string>(ref: F): FileSource<F> {
  return { type: "file", [FILE_REF_PROP]: ref } as FileSource<F>;
}

export function isFile(refObject: any): refObject is FileSource<string> {
  return (
    typeof refObject === "object" &&
    refObject !== null &&
    "type" in refObject &&
    refObject["type"] === "file" &&
    FILE_REF_PROP in refObject
  );
}
