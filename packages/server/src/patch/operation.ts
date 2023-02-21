import { isNonEmpty, NonEmptyArray } from "../fp/array";
import * as result from "../fp/result";
import type { JSONValue } from "./ops";
import { z } from "zod";
import { pipe } from "../fp/util";

const JSONValue: z.ZodType<JSONValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JSONValue),
    z.record(JSONValue),
  ])
);

/**
 * Raw JSON patch operation.
 */
export const OperationJSON = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("add"),
      path: z.string(),
      value: JSONValue,
    })
    .strict(),
  z
    .object({
      op: z.literal("remove"),
      /**
       * Must be non-root
       */
      path: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("replace"),
      path: z.string(),
      value: JSONValue,
    })
    .strict(),
  z
    .object({
      op: z.literal("move"),
      /**
       * Must be non-root and not a proper prefix of "path".
       */
      from: z.string(),
      path: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("copy"),
      from: z.string(),
      path: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("test"),
      path: z.string(),
      value: JSONValue,
    })
    .strict(),
]);
export type OperationJSON = z.infer<typeof OperationJSON>;

/**
 * Parsed form of JSON patch operation.
 */
export type Operation =
  | {
      op: "add";
      path: string[];
      value: JSONValue;
    }
  | {
      op: "remove";
      path: NonEmptyArray<string>;
    }
  | {
      op: "replace";
      path: string[];
      value: JSONValue;
    }
  | {
      op: "move";
      /**
       * Must be non-root and not a proper prefix of "path".
       */
      // TODO: Replace with common prefix field
      from: NonEmptyArray<string>;
      path: string[];
    }
  | {
      op: "copy";
      from: string[];
      path: string[];
    }
  | {
      op: "test";
      path: string[];
      value: JSONValue;
    };

/**
 * A signifies an issue that makes a PatchJSON or an OperationJSON invalid.
 * Unlike PatchError, a StaticPatchIssue indicates an issue with the patch
 * document itself; it is independent of any document which the patch or
 * might be applied to.
 */
export type StaticPatchIssue = {
  path: string[];
  message: string;
};

export function prefixIssuePath(
  prefix: string,
  { path, message }: StaticPatchIssue
): StaticPatchIssue {
  return { path: [prefix, ...path], message };
}

function createIssueAtPath(path: string[]) {
  return (message: string): StaticPatchIssue => ({
    path,
    message,
  });
}

function isProperPathPrefix(prefix: string[], path: string[]): boolean {
  if (prefix.length >= path.length) {
    // A proper prefix cannot be longer or have the same length as the path
    return false;
  }
  for (let i = 0; i < prefix.length; ++i) {
    if (prefix[i] !== path[i]) {
      return false;
    }
  }
  return true;
}

export function parseOperation(
  operation: OperationJSON
): result.Result<Operation, NonEmptyArray<StaticPatchIssue>> {
  const path = parseJSONPointer(operation.path);

  switch (operation.op) {
    case "add":
    case "replace":
    case "test":
      return pipe(
        path,
        result.mapErr(
          (error: string): NonEmptyArray<StaticPatchIssue> => [
            createIssueAtPath(["path"])(error),
          ]
        ),
        result.map((path: string[]) => ({
          op: operation.op,
          path,
          value: operation.value,
        }))
      );
    case "remove":
      return pipe(
        path,
        result.filterOrElse(isNonEmpty, () => "Cannot remove root"),
        result.mapErr(
          (error: string): NonEmptyArray<StaticPatchIssue> => [
            createIssueAtPath(["path"])(error),
          ]
        ),
        result.map((path: NonEmptyArray<string>) => ({
          op: operation.op,
          path,
        }))
      );
    case "move":
      return pipe(
        result.allT<
          [from: NonEmptyArray<string>, path: string[]],
          StaticPatchIssue
        >([
          pipe(
            parseJSONPointer(operation.from),
            result.filterOrElse(isNonEmpty, () => "Cannot move root"),
            result.mapErr(createIssueAtPath(["from"]))
          ),
          pipe(path, result.mapErr(createIssueAtPath(["path"]))),
        ]),
        result.filterOrElse(
          ([from, path]) => !isProperPathPrefix(from, path),
          (): NonEmptyArray<StaticPatchIssue> => [
            createIssueAtPath(["from"])("Cannot be a proper prefix of path"),
          ]
        ),
        result.map(([from, path]) => ({
          op: operation.op,
          from,
          path,
        }))
      );
    case "copy":
      return pipe(
        result.allT<[from: string[], path: string[]], StaticPatchIssue>([
          pipe(
            parseJSONPointer(operation.from),
            result.mapErr(createIssueAtPath(["from"]))
          ),
          pipe(path, result.mapErr(createIssueAtPath(["path"]))),
        ]),
        result.map(([from, path]) => ({
          op: operation.op,
          from,
          path,
        }))
      );
  }
}

export function parseJSONPointer(
  path: string
): result.Result<string[], string> {
  if (path === "/") return result.ok([]);
  if (!path.startsWith("/"))
    return result.err("JSON pointer must start with /");

  return result.ok(
    path
      .substring(1)
      .split("/")
      // TODO: Handle invalid escapes?
      .map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"))
  );
}

export function formatJSONPointer(path: string[]): string {
  return `/${path
    .map((key) => key.replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("/")}`;
}
