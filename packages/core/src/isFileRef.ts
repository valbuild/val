import { VAL_EXTENSION } from "./source";
import { FILE_REF_PROP } from "./source/file";

export function isFileRef(
  value: unknown
): value is { [FILE_REF_PROP]: string; [VAL_EXTENSION]: "file" } {
  if (!value) return false;
  if (typeof value !== "object") return false;
  if (FILE_REF_PROP in value && VAL_EXTENSION in value) {
    if (
      value[VAL_EXTENSION] === "file" &&
      typeof value[FILE_REF_PROP] === "string"
    ) {
      return true;
    }
  }
  return false;
}
