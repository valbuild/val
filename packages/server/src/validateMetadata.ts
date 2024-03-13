import { FileMetadata, ImageMetadata } from "@valbuild/core";

export function validateMetadata<Metadata extends ImageMetadata | FileMetadata>(
  actualMetadata: unknown,
  expectedMetadata: Metadata
):
  | false
  | {
      missingMetadata?: (keyof Metadata)[];
      erroneousMetadata?: Partial<Record<keyof Metadata, string>>;
      globalErrors?: string[];
    } {
  const missingMetadata: (keyof Metadata)[] = [];
  const erroneousMetadata: Partial<Record<keyof Metadata, string>> = {};
  if (typeof actualMetadata !== "object" || actualMetadata === null) {
    return { globalErrors: ["Metadata is wrong type: must be an object."] };
  }
  if (Array.isArray(actualMetadata)) {
    return { globalErrors: ["Metadata is wrong type: cannot be an array."] };
  }
  const recordMetadata = actualMetadata as Record<string, unknown>;
  const globalErrors: string[] = [];
  for (const anyKey in expectedMetadata) {
    if (typeof anyKey !== "string") {
      globalErrors.push(
        `Expected metadata has key '${anyKey}' that is not typeof 'string', but: '${typeof anyKey}'. This is most likely a Val bug.`
      );
    } else {
      if (anyKey in actualMetadata) {
        const key = anyKey as keyof Metadata & string;
        if (expectedMetadata[key] !== recordMetadata[key]) {
          erroneousMetadata[
            key
          ] = `Expected metadata '${key}' to be ${JSON.stringify(
            expectedMetadata[key as keyof Metadata]
          )}, but got ${JSON.stringify(recordMetadata[key])}.`;
        }
      } else {
        missingMetadata.push(anyKey as keyof Metadata);
      }
    }
  }
  if (
    globalErrors.length === 0 &&
    missingMetadata.length === 0 &&
    Object.keys(erroneousMetadata).length === 0
  ) {
    return false;
  }
  return { missingMetadata, erroneousMetadata };
}
