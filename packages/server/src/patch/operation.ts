import { isNonEmpty, NonEmptyArray } from "../fp/array";
import * as result from "../fp/result";
import { JSONValue } from "./ops";

export type JSONPointer = `/${string}`;
export type Operation =
  | {
      op: "add";
      path: JSONPointer;
      value: JSONValue;
    }
  | {
      op: "remove";
      /**
       * Must be non-root
       */
      path: JSONPointer;
    }
  | {
      op: "replace";
      path: JSONPointer;
      value: JSONValue;
    }
  | {
      op: "move";
      /**
       * Must be non-root and not a proper prefix of "path".
       */
      from: JSONPointer;
      path: JSONPointer;
    }
  | {
      op: "copy";
      from: JSONPointer;
      path: JSONPointer;
    }
  | {
      op: "test";
      path: JSONPointer;
      value: JSONValue;
    };

/**
 * A PatchValidationError signifies an error that makes a Patch or an Operation
 * invalid. Unlike PatchError, a PatchValidationError is independent of any
 * document which the Patch or Operation might be applied to.
 */
export type PatchValidationError = {
  path: string[];
  message: string;
};

export function prefixErrorPath(
  prefix: string,
  { path, message }: PatchValidationError
): PatchValidationError {
  return { path: [prefix, ...path], message };
}

const VALID_OPS = ["add", "remove", "replace", "move", "copy", "test"] as const;

function isValidOp(op: unknown): op is Operation["op"] {
  return (VALID_OPS as readonly unknown[]).includes(op);
}

function isJSONPath(path: string): path is JSONPointer {
  return path.startsWith("/");
}

function isRoot(path: JSONPointer): path is "/" {
  return path === "/";
}

function isProperPathPrefix(prefix: JSONPointer, path: JSONPointer): boolean {
  return prefix !== path && `${path}/`.startsWith(`${prefix}/`);
}

export function validateOperation(
  operation: JSONValue
): result.Result<void, NonEmptyArray<PatchValidationError>> {
  if (
    typeof operation !== "object" ||
    operation === null ||
    Array.isArray(operation)
  ) {
    return result.err([
      {
        path: [],
        message: "Not an object",
      },
    ]);
  }

  if (!("op" in operation)) {
    return result.err([
      {
        path: ["op"],
        message: "Missing member",
      },
    ]);
  } else if (!isValidOp(operation.op)) {
    return result.err([
      {
        path: ["op"],
        message: "Invalid op",
      },
    ]);
  }

  const errors: PatchValidationError[] = [];

  let path: JSONPointer | null = null;
  if (!("path" in operation)) {
    errors.push({
      path: ["path"],
      message: "Missing member",
    });
  } else if (
    typeof operation.path !== "string" ||
    !isJSONPath(operation.path)
  ) {
    errors.push({
      path: ["path"],
      message: "Not a JSON path",
    });
  } else {
    path = operation.path;

    if (operation.op === "remove" && isRoot(path)) {
      errors.push({
        path: ["path"],
        message: "Cannot remove root",
      });
    }
  }

  if (
    operation.op === "add" ||
    operation.op === "replace" ||
    operation.op === "test"
  ) {
    if (!("value" in operation)) {
      errors.push({
        path: ["value"],
        message: "Missing member",
      });
    }
  }

  if (operation.op === "move" || operation.op === "copy") {
    if (!("from" in operation)) {
      errors.push({
        path: ["from"],
        message: "Missing member",
      });
    } else if (
      typeof operation.from !== "string" ||
      !isJSONPath(operation.from)
    ) {
      errors.push({
        path: ["from"],
        message: "Not a JSON path",
      });
    } else if (operation.op === "move" && path !== null) {
      const from = operation.from;

      if (isRoot(from)) {
        errors.push({
          path: ["from"],
          message: "Cannot move root",
        });
      }

      // The "from" location MUST NOT be a proper prefix of the "path"
      // location; i.e., a location cannot be moved into one of its children.
      if (isProperPathPrefix(from, path)) {
        errors.push({
          path: ["from"],
          message: "Cannot be a proper prefix of path",
        });
      }
    }
  }

  if (isNonEmpty(errors)) {
    return result.err(errors);
  } else {
    return result.voidOk;
  }
}

export function parseJSONPointer(path: JSONPointer): string[] {
  if (path === "/") return [];
  return path
    .substring(1)
    .split("/")
    .map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function formatJSONPointer(path: string[]): JSONPointer {
  return `/${path
    .map((key) => key.replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("/")}`;
}
