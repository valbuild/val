import * as result from "../fp/result";
import { NonEmptyArray, flatten, isNonEmpty } from "../fp/nonEmptyArray";
import { pipe } from "../fp/util";
import { JSONValue } from "./ops";
import { Ops, PatchError } from "./ops";

export type Operation =
  | {
      op: "add";
      path: string;
      value: JSONValue;
    }
  | {
      op: "remove";
      path: string;
    }
  | {
      op: "replace";
      path: string;
      value: JSONValue;
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
      value: JSONValue;
    };

const VALID_OPS = [
  "add",
  "remove",
  "replace",
  "move",
  "copy",
  "test",
] as const satisfies readonly Operation["op"][];

function isValidOp(op: unknown): op is Operation["op"] {
  return (VALID_OPS as readonly unknown[]).includes(op);
}

function validateOperation(
  operation: JSONValue
): result.Result<void, NonEmptyArray<PatchError>> {
  if (
    typeof operation !== "object" ||
    operation === null ||
    Array.isArray(operation)
  ) {
    return result.err([new PatchError("Operation is not an object")]);
  }

  if (!("op" in operation)) {
    return result.err([new PatchError('Operation is missing member "op"')]);
  } else if (!isValidOp(operation.op)) {
    return result.err([new PatchError('Operation has invalid member "op"')]);
  }

  const errors: PatchError[] = [];

  if (!("path" in operation)) {
    errors.push(new PatchError('Operation is missing member "path"'));
  } else if (typeof operation.path !== "string") {
    errors.push(new PatchError('Operation is has invalid member "path"'));
  }

  if (
    operation.op === "add" ||
    operation.op === "replace" ||
    operation.op === "test"
  ) {
    if (!("value" in operation)) {
      errors.push(new PatchError('Operation is missing member "value"'));
    }
  }

  if (operation.op === "move" || operation.op === "copy") {
    if (!("from" in operation)) {
      errors.push(new PatchError('Operation is missing member "from"'));
    } else if (typeof operation.path !== "string") {
      errors.push(new PatchError('Operation is has invalid member "from"'));
    }
  }

  if (isNonEmpty(errors)) {
    return result.err(errors);
  } else {
    return result.voidOk;
  }
}

export function validatePatch(
  patch: JSONValue
): result.Result<Operation[], NonEmptyArray<PatchError>> {
  if (!Array.isArray(patch)) {
    return result.err([new PatchError("Patch is not an array")]);
  }

  return pipe(
    patch.map(validateOperation),
    result.allV,
    result.mapErr<
      NonEmptyArray<NonEmptyArray<PatchError>>,
      NonEmptyArray<PatchError>
    >(flatten),
    result.flatMap<void, Operation[], NonEmptyArray<PatchError>>(() =>
      result.ok(patch as Operation[])
    )
  );
}

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
