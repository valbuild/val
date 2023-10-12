import { array, pipe, result } from "../fp";
import { Operation, OperationJSON } from "./operation";
import { Patch, PatchJSON } from "./patch";

function parseJSONPointerReferenceToken(value: string): string | undefined {
  if (value.endsWith("~")) {
    return undefined;
  }
  try {
    return value.replace(/~./, (escaped) => {
      switch (escaped) {
        case "~0":
          return "~";
        case "~1":
          return "/";
      }
      throw new Error();
    });
  } catch (e) {
    return undefined;
  }
}

export function parseJSONPointer(
  pointer: string
): result.Result<string[], string> {
  if (pointer === "/") return result.ok([]);
  if (!pointer.startsWith("/"))
    return result.err("JSON pointer must start with /");

  const tokens = pointer
    .substring(1)
    .split("/")
    .map(parseJSONPointerReferenceToken);
  if (
    tokens.every(
      (token: string | undefined): token is string => token !== undefined
    )
  ) {
    return result.ok(tokens);
  } else {
    return result.err("Invalid JSON pointer escape sequence");
  }
}

export function formatJSONPointerReferenceToken(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function formatJSONPointer(path: string[]): string {
  return `/${path.map(formatJSONPointerReferenceToken).join("/")}`;
}

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
): result.Result<Operation, array.NonEmptyArray<StaticPatchIssue>> {
  const path = parseJSONPointer(operation.path);

  switch (operation.op) {
    case "file":
    case "add":
    case "replace":
    case "test":
      return pipe(
        path,
        result.mapErr(
          (error: string): array.NonEmptyArray<StaticPatchIssue> => [
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
        result.filterOrElse(array.isNonEmpty, () => "Cannot remove root"),
        result.mapErr(
          (error: string): array.NonEmptyArray<StaticPatchIssue> => [
            createIssueAtPath(["path"])(error),
          ]
        ),
        result.map((path: array.NonEmptyArray<string>) => ({
          op: operation.op,
          path,
        }))
      );
    case "move":
      return pipe(
        result.allT<
          [from: array.NonEmptyArray<string>, path: string[]],
          StaticPatchIssue
        >([
          pipe(
            parseJSONPointer(operation.from),
            result.filterOrElse(array.isNonEmpty, () => "Cannot move root"),
            result.mapErr(createIssueAtPath(["from"]))
          ),
          pipe(path, result.mapErr(createIssueAtPath(["path"]))),
        ]),
        result.filterOrElse(
          ([from, path]) => !isProperPathPrefix(from, path),
          (): array.NonEmptyArray<StaticPatchIssue> => [
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

export function parsePatch(
  patch: PatchJSON
): result.Result<Patch, array.NonEmptyArray<StaticPatchIssue>> {
  return pipe(
    patch
      .map(parseOperation)
      .map(
        result.mapErr(
          array.map((error: StaticPatchIssue, index: number) =>
            prefixIssuePath(index.toString(), error)
          )
        )
      ),
    result.all,
    result.mapErr(array.flatten<StaticPatchIssue>)
  );
}
