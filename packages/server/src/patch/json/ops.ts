import * as result from "../../fp/result";
import { NonEmptyArray } from "../../fp/array";
import { Result } from "../../fp/result";
import {
  deepClone,
  deepEqual,
  isNotRoot,
  JSONValue,
  Ops,
  parseAndValidateArrayIndex,
  PatchError,
} from "../ops";
import { pipe } from "../../fp/util";

type JSONOpsResult<T> = result.Result<T, PatchError>;

function parseAndValidateArrayInsertIndex(
  key: string,
  nodes: JSONValue[]
): JSONOpsResult<number> {
  if (key === "-") {
    return result.ok(nodes.length);
  }

  return pipe(
    parseAndValidateArrayIndex(key),
    result.filterOrElse(
      (index: number): boolean => index <= nodes.length,
      () => new PatchError("Array index out of bounds")
    )
  );
}

function parseAndValidateArrayInboundsIndex(
  key: string,
  nodes: JSONValue[]
): JSONOpsResult<number> {
  return pipe(
    parseAndValidateArrayIndex(key),
    result.filterOrElse(
      (index: number): boolean => index < nodes.length,
      () => new PatchError("Array index out of bounds")
    )
  );
}

function replaceInNode(
  node: JSONValue,
  key: string,
  value: JSONValue
): JSONOpsResult<JSONValue> {
  if (Array.isArray(node)) {
    return pipe(
      parseAndValidateArrayInboundsIndex(key, node),
      result.map((index: number) => {
        const replaced = node[index];
        node[index] = value;
        return replaced;
      })
    );
  } else if (typeof node === "object" && node !== null) {
    // Prototype pollution protection
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      const replaced = node[key];
      node[key] = value;
      return result.ok(replaced);
    } else {
      return result.err(
        new PatchError("Cannot replace object element which does not exist")
      );
    }
  }

  return result.err(new PatchError("Cannot replace in non-object/array"));
}

function replaceAtPath(
  document: JSONValue,
  path: string[],
  value: JSONValue
): JSONOpsResult<[document: JSONValue, replaced: JSONValue]> {
  if (isNotRoot(path)) {
    return pipe(
      getPointerFromPath(document, path),
      result.flatMap(([node, key]: Pointer) => replaceInNode(node, key, value)),
      result.map((replaced: JSONValue) => [document, replaced])
    );
  } else {
    return result.ok([value, document]);
  }
}

function getFromNode(
  node: JSONValue,
  key: string
): JSONOpsResult<JSONValue | undefined> {
  if (Array.isArray(node)) {
    return pipe(
      parseAndValidateArrayIndex(key),
      result.flatMap((index: number) => {
        if (index >= node.length) {
          return result.err(new PatchError("Array index out of bounds"));
        } else {
          return result.ok(node[index]);
        }
      })
    );
  } else if (typeof node === "object" && node !== null) {
    // Prototype pollution protection
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      return result.ok(node[key]);
    } else {
      return result.ok(undefined);
    }
  }

  return result.err(new PatchError("Cannot access non-object/array"));
}

type Pointer = [node: JSONValue, key: string];
function getPointerFromPath(
  node: JSONValue,
  path: NonEmptyArray<string>
): JSONOpsResult<Pointer> {
  let targetNode: JSONValue = node;
  let key: string = path[0];
  for (let i = 0; i < path.length - 1; ++i, key = path[i]) {
    const childNode = getFromNode(targetNode, key);
    if (result.isErr(childNode)) {
      return childNode;
    }
    if (childNode.value === undefined) {
      return result.err(
        new PatchError("Path refers to non-existing object/array")
      );
    }
    targetNode = childNode.value;
  }

  return result.ok([targetNode, key]);
}

function getAtPath(node: JSONValue, path: string[]): JSONOpsResult<JSONValue> {
  return pipe(
    path,
    result.flatMapReduce(
      (node: JSONValue, key: string) =>
        pipe(
          getFromNode(node, key),
          result.filterOrElse(
            (childNode: JSONValue | undefined): childNode is JSONValue =>
              childNode !== undefined,
            () => new PatchError("Path refers to non-existing object/array")
          )
        ),
      node
    )
  );
}

function removeFromNode(
  node: JSONValue,
  key: string
): JSONOpsResult<JSONValue> {
  if (Array.isArray(node)) {
    return pipe(
      parseAndValidateArrayInboundsIndex(key, node),
      result.map((index: number) => {
        const [removed] = node.splice(index, 1);
        return removed;
      })
    );
  } else if (typeof node === "object" && node !== null) {
    // Prototype pollution protection
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      const removed = node[key];
      delete node[key];
      return result.ok(removed);
    }
  }

  return result.err(new PatchError("Cannot remove from non-object/array"));
}

function removeAtPath(
  document: JSONValue,
  path: NonEmptyArray<string>
): JSONOpsResult<JSONValue> {
  return pipe(
    getPointerFromPath(document, path),
    result.flatMap(([node, key]: Pointer) => removeFromNode(node, key))
  );
}

function addToNode(
  node: JSONValue,
  key: string,
  value: JSONValue
): JSONOpsResult<JSONValue | undefined> {
  if (Array.isArray(node)) {
    return pipe(
      parseAndValidateArrayInsertIndex(key, node),
      result.map((index: number) => {
        node.splice(index, 0, value);
        return undefined;
      })
    );
  } else if (typeof node === "object" && node !== null) {
    let replaced: JSONValue | undefined;
    // Prototype pollution protection
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      replaced = node[key];
    }
    node[key] = value;
    return result.ok(replaced);
  }

  return result.err(new PatchError("Cannot add to non-object/array"));
}

function addAtPath(
  document: JSONValue,
  path: string[],
  value: JSONValue
): JSONOpsResult<[document: JSONValue, replaced?: JSONValue]> {
  if (isNotRoot(path)) {
    return pipe(
      getPointerFromPath(document, path),
      result.flatMap(([node, key]: Pointer) => addToNode(node, key, value)),
      result.map((replaced: JSONValue | undefined) => [document, replaced])
    );
  } else {
    return result.ok([value, document]);
  }
}

function pickDocument<
  T extends readonly [document: JSONValue, ...result: unknown[]]
>([document]: T) {
  return document;
}

export class JSONOps implements Ops<JSONValue, never> {
  add(
    document: JSONValue,
    path: string[],
    value: JSONValue
  ): Result<JSONValue, PatchError> {
    return pipe(addAtPath(document, path, value), result.map(pickDocument));
  }
  remove(
    document: JSONValue,
    path: NonEmptyArray<string>
  ): Result<JSONValue, PatchError> {
    return pipe(
      removeAtPath(document, path),
      result.map(() => document)
    );
  }
  replace(
    document: JSONValue,
    path: string[],
    value: JSONValue
  ): Result<JSONValue, PatchError> {
    return pipe(replaceAtPath(document, path, value), result.map(pickDocument));
  }
  move(
    document: JSONValue,
    from: NonEmptyArray<string>,
    path: string[]
  ): Result<JSONValue, PatchError> {
    return pipe(
      removeAtPath(document, from),
      result.flatMap((removed: JSONValue) =>
        addAtPath(document, path, removed)
      ),
      result.map(pickDocument)
    );
  }
  copy(
    document: JSONValue,
    from: string[],
    path: string[]
  ): Result<JSONValue, PatchError> {
    return pipe(
      getAtPath(document, from),
      result.flatMap((value: JSONValue) =>
        addAtPath(document, path, deepClone(value))
      ),
      result.map(pickDocument)
    );
  }
  test(
    document: JSONValue,
    path: string[],
    value: JSONValue
  ): Result<boolean, PatchError> {
    return pipe(
      getAtPath(document, path),
      result.map((documentValue: JSONValue) => deepEqual(value, documentValue))
    );
  }
}
