import { result, pipe } from "../fp";
import { Ops, PatchError } from "./ops";
import { Operation, OperationJSON } from "./operation";

export type Patch = Operation[];
export type PatchJSON = OperationJSON[];

export type ParentRef =
  | { type: "head"; headContentSha: string }
  | { type: "patch"; patchBlockSha: string };

export type PatchBlock = {
  patch: Patch;
  parentRef: ParentRef;
};

function apply<T, E>(
  document: T,
  ops: Ops<T, E>,
  op: Operation,
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
    case "file": {
      return result.err(new PatchError("Cannot apply a file patch here"));
    }
  }
}

export function applyPatch<T, E>(
  document: T,
  ops: Ops<T, E>,
  patch: Operation[],
): result.Result<T, E | PatchError> {
  return pipe(
    patch,
    result.flatMapReduce(
      (doc: T, op: Operation): result.Result<T, E | PatchError> =>
        apply(doc, ops, op),
      document,
    ),
  );
}
