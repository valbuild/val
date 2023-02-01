import * as result from "../result";
import { StaticValue } from "./ops";
import { Ops, PatchError } from "./ops";

export type Operation =
  | {
      op: "add";
      path: string;
      value: StaticValue;
    }
  | {
      op: "remove";
      path: string;
    }
  | {
      op: "replace";
      path: string;
      value: StaticValue;
    }
  | {
      op: "move";
      from: string;
      path: string;
    }
  | {
      op: "copy";
      from: string;
      path: string;
    }
  | {
      op: "test";
      path: string;
      value: StaticValue;
    };

export function applyPatch<T, E>(
  document: T,
  ops: Ops<T, E>,
  patch: Operation[]
): result.Result<T, E | PatchError> {
  return result.flatMapReduce(
    (doc: T, op: Operation): result.Result<T, E | PatchError> =>
      apply(doc, ops, op)
  )(patch, document);
}

function parsePath<E>(path: string): result.Result<string[], E | PatchError> {
  if (!path.startsWith("/")) {
    return result.err(new PatchError("Invalid path"));
  }
  return result.ok(path.substring(1).split("/"));
}

function apply<T, E>(
  document: T,
  ops: Ops<T, E>,
  op: Operation
): result.Result<T, E | PatchError> {
  return result.flatMap((path: string[]): result.Result<T, E | PatchError> => {
    switch (op.op) {
      case "add":
        return ops.add(document, path, op.value);
      case "remove":
        return ops.remove(document, path);
      case "replace":
        return ops.replace(document, path, op.value);
      case "move": {
        return result.flatMap((from: string[]) =>
          ops.move(document, from, path)
        )(parsePath(op.from));
      }
      case "copy": {
        return result.flatMap((from: string[]) =>
          ops.copy(document, from, path)
        )(parsePath(op.from));
      }
      case "test": {
        if (!ops.test(document, path, op.value)) {
          return result.err(new PatchError("Test failed"));
        }
        return result.ok(document);
      }
    }
  })(parsePath(op.path));
}
