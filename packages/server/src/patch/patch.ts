import * as result from "../fp/result";
import { NonEmptyArray, flatten, map } from "../fp/array";
import { pipe } from "../fp/util";
import { JSONValue } from "./ops";
import { Ops, PatchError } from "./ops";
import {
  Operation,
  PatchValidationError,
  parseJSONPath,
  prefixErrorPath,
  validateOperation,
} from "./operation";

export type Patch = Operation[];

export function validatePatch(
  patch: JSONValue
): result.Result<Patch, NonEmptyArray<PatchValidationError>> {
  if (!Array.isArray(patch)) {
    return result.err([
      {
        path: [],
        message: "Not an array",
      },
    ]);
  }

  return pipe(
    patch
      .map(validateOperation)
      .map(
        result.mapErr(
          map((error: PatchValidationError, index: number) =>
            prefixErrorPath(`/${index}`, error)
          )
        )
      ),
    result.allV,
    result.mapErr(flatten<PatchValidationError>),
    result.map(() => patch as Operation[])
  );
}

function apply<T, E>(
  document: T,
  ops: Ops<T, E>,
  op: Operation
): result.Result<T, E | PatchError> {
  const path = parseJSONPath(op.path);
  switch (op.op) {
    case "add":
      return ops.add(document, path, op.value);
    case "remove":
      return ops.remove(document, path as NonEmptyArray<string>);
    case "replace":
      return ops.replace(document, path, op.value);
    case "move":
      return ops.move(
        document,
        parseJSONPath(op.from) as NonEmptyArray<string>,
        path
      );
    case "copy":
      return ops.copy(document, parseJSONPath(op.from), path);
    case "test": {
      if (!ops.test(document, path, op.value)) {
        return result.err(new PatchError("Test failed"));
      }
      return result.ok(document);
    }
  }
}

export function applyPatch<T, E>(
  document: T,
  ops: Ops<T, E>,
  patch: Operation[]
): result.Result<T, E | PatchError> {
  return pipe(
    patch,
    result.flatMapReduce(
      (doc: T, op: Operation): result.Result<T, E | PatchError> =>
        apply(doc, ops, op),
      document
    )
  );
}
