import * as result from "../fp/result";
import { NonEmptyArray, flatten, map } from "../fp/array";
import { pipe } from "../fp/util";
import { Ops, PatchError } from "./ops";
import {
  StaticPatchIssue,
  prefixIssuePath,
  parseOperation,
  Operation,
  OperationJSON,
} from "./operation";
import { z } from "zod";

export const PatchJSON = z.array(OperationJSON);
export type PatchJSON = z.infer<typeof PatchJSON>;
export type Patch = Operation[];

export function parsePatch(
  patch: PatchJSON
): result.Result<Patch, NonEmptyArray<StaticPatchIssue>> {
  return pipe(
    patch
      .map(parseOperation)
      .map(
        result.mapErr(
          map((error: StaticPatchIssue, index: number) =>
            prefixIssuePath(index.toString(), error)
          )
        )
      ),
    result.all,
    result.mapErr(flatten<StaticPatchIssue>)
  );
}

function apply<T, E>(
  document: T,
  ops: Ops<T, E>,
  op: Operation
): result.Result<T, E | PatchError> {
  switch (op.op) {
    case "add":
      return ops.add(document, op.path, op.value);
    case "remove":
      return ops.remove(document, op.path);
    case "replace":
      return ops.replace(document, op.path, op.value);
    case "move":
      return ops.move(document, op.from, op.path);
    case "copy":
      return ops.copy(document, op.from, op.path);
    case "test": {
      if (!ops.test(document, op.path, op.value)) {
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
