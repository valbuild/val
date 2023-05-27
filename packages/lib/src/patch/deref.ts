import { FILE_REF_PROP, isFile } from "../source/file";
import { result } from "../fp";
import { isRemote, REMOTE_REF_PROP } from "../source/remote";
import { Ops, PatchError } from "./ops";
import { Patch } from "./patch";

function derefPath(
  path: string[]
): result.Result<[string[], string[] | null], PatchError> {
  const dereffedPath: string[] = [];
  let referencedPath: string[] | null = null;
  for (const segment of path) {
    if (segment.startsWith("$")) {
      const dereffedSegment = segment.slice(1);
      dereffedPath.push(dereffedSegment);
      referencedPath = [];
      for (const segment of path.slice(dereffedPath.length)) {
        if (segment.startsWith("$")) {
          return result.err(
            new PatchError(
              `Cannot reference within reference: ${segment}. Path: ${path.join(
                "/"
              )}`
            )
          );
        }
        referencedPath.push(segment);
      }
      break;
    } else {
      dereffedPath.push(segment);
    }
  }
  return result.ok([dereffedPath, referencedPath]);
}

export type DerefPatchResult = {
  dereferencedPatch: Patch;
  fileUpdates: { [path: string]: string };
  remotePatches: { [ref: string]: Patch };
};

export function derefPatch<D, E>(
  patch: Patch,
  document: D,
  ops: Ops<D, E>
): result.Result<DerefPatchResult, E | PatchError> {
  const remotePatches: {
    [ref: string]: Patch;
  } = {};
  const fileUpdates: {
    [file: string]: string;
  } = {};
  const dereferencedPatch: Patch = [];
  for (const op of patch) {
    if (op.op === "replace") {
      const maybeDerefRes = derefPath(op.path);
      if (result.isErr(maybeDerefRes)) {
        return maybeDerefRes;
      }
      const [dereffedPath, referencedPath] = maybeDerefRes.value;
      if (referencedPath) {
        const maybeValue = ops.get(document, dereffedPath);
        if (result.isOk(maybeValue)) {
          const value = maybeValue.value;
          if (isFile(value)) {
            if (referencedPath.length > 0) {
              return result.err(
                new PatchError(
                  `Cannot sub-reference file reference at path: ${dereffedPath.join(
                    "/"
                  )}`
                )
              );
            }
            if (typeof op.value !== "string") {
              return result.err(
                new PatchError(
                  `Expected base64 encoded string value for file reference, got ${JSON.stringify(
                    op.value
                  )}`
                )
              );
            }
            fileUpdates[value[FILE_REF_PROP]] = op.value;
          } else if (isRemote(value)) {
            if (!remotePatches[value[REMOTE_REF_PROP]]) {
              remotePatches[value[REMOTE_REF_PROP]] = [];
            }
            remotePatches[value[REMOTE_REF_PROP]].push({
              op: "replace",
              path: referencedPath,
              value: op.value,
            });
          } else {
            return result.err(
              new PatchError(
                `Unknown reference: ${JSON.stringify(
                  op
                )} at path: ${dereffedPath.join("/")}`
              )
            );
          }
        } else {
          return maybeValue;
        }
      } else {
        dereferencedPatch.push(op);
      }
    } else {
      throw new Error(`Unimplemented operation: ${JSON.stringify(op)}`);
    }
  }

  return result.ok({
    remotePatches,
    fileUpdates,
    dereferencedPatch,
  });
}
