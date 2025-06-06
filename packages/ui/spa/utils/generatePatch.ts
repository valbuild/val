import { Operation } from "@valbuild/core/patch";
import { array } from "@valbuild/core/fp";

// NOTE: we are using the rfc6902 impl which seems good enough for now
import { createPatch } from "rfc6902";

export function generatePatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any,
  basePath?: string[],
): Operation[] {
  return createPatch(input, output).map((op) => {
    if (op.op === "move" || op.op === "copy") {
      return {
        op: op.op,
        from: convertPath(op.from, basePath),
        path: convertPath(op.from, basePath),
      };
    }
    return {
      ...op,
      path: convertPath(op.path, basePath),
    };
  });
}

function convertPath(
  path: string,
  basePath?: string[],
): array.NonEmptyArray<string> {
  if (basePath) {
    return basePath.concat(
      path.split("/").slice(1) as array.NonEmptyArray<string>,
    ) as array.NonEmptyArray<string>;
  }
  return path.split("/").slice(1) as array.NonEmptyArray<string>;
}
