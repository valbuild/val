import ts from "typescript";
import { StaticValue } from "./analysis";
import { add, copy, move, remove, replace, test } from "./ops";

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

export function applyPatch(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  patch: Operation[]
): ts.SourceFile {
  let result = sourceFile;
  for (const op of patch) {
    result = apply(result, node, op);
  }
  return result;
}

function parsePath(path: string) {
  if (!path.startsWith("/")) {
    throw Error("Invalid path");
  }
  return path.substring(1).split("/");
}

function apply(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  op: Operation
): ts.SourceFile {
  const path = parsePath(op.path);
  switch (op.op) {
    case "add":
      return add(sourceFile, node, path, op.value)[0];
    case "remove":
      return remove(sourceFile, node, path)[0];
    case "replace":
      return replace(sourceFile, node, path, op.value)[0];
    case "move": {
      const from = parsePath(op.from);
      return move(sourceFile, node, from, path)[0];
    }
    case "copy": {
      const from = parsePath(op.from);
      return copy(sourceFile, node, from, path)[0];
    }
    case "test": {
      if (!test(sourceFile, path, op.value)) {
        throw Error("Test failed");
      }
      return sourceFile;
    }
  }
}
