import {
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import type { JSONValue, Patch } from "@valbuild/core/patch";

/**
 * Turn "put this old value here" into a patch.
 *
 * A restore is one `replace` at the destination path, and deliberately nothing
 * cleverer. The earlier design tried to compute a restore by diffing the past
 * against the present and turning the difference into ops, which meant guessing
 * which of today's array items corresponds to which of the commit's - and array
 * items splice, so the guess is sometimes wrong in a way that silently writes a
 * value into the wrong row. Here a person picked both ends, so there is nothing
 * to infer.
 *
 * Staged, not applied: this produces a patch like any other edit, which lands
 * in pending changes for review and publishes with everything else. A restore
 * that wrote straight to the branch would be the one edit in the Studio that
 * skipped the step where you look at it first.
 */
export function buildRestorePatch(to: SourcePath, value: JSONValue): Patch {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(to);
  return [
    {
      op: "replace",
      path: Internal.createPatchPath(modulePath),
      value,
    },
  ];
}

export function moduleFilePathOf(path: SourcePath): ModuleFilePath {
  return Internal.splitModuleFilePathAndModulePath(path)[0];
}

/**
 * The media a value refers to, found through its schema rather than its shape.
 *
 * Nothing decides "this is media" by looking at the value — the schema does
 * (`type === "image" | "file"`). Guessing from the value would pick up any
 * object that happens to have a `path`, and miss a media field whose value is
 * shaped unusually.
 */
export type RestoredMedia = {
  /** The file this value refers to. */
  filePath: string;
  /** Where in the restored value it sits, RELATIVE to the restore target. */
  fieldPath: string[];
  /** What the value says the bytes are: width, height, mime type. */
  metadata: JSONValue | undefined;
};

export function collectMedia(
  schema: SerializedSchema,
  value: JSONValue,
): RestoredMedia[] {
  const found: RestoredMedia[] = [];
  walk(schema, value, [], found);
  // One file referenced twice is uploaded once — keyed by the file, since that
  // is what the upload is.
  const seen = new Set<string>();
  return found.filter((entry) => {
    if (seen.has(entry.filePath)) return false;
    seen.add(entry.filePath);
    return true;
  });
}

function walk(
  schema: SerializedSchema,
  value: JSONValue,
  at: string[],
  found: RestoredMedia[],
): void {
  if (value === null || value === undefined) {
    return;
  }
  if (schema.type === "image" || schema.type === "file") {
    if (isObject(value) && typeof value["path"] === "string") {
      // Everything the value carries EXCEPT the path is what was read from the
      // bytes, which is exactly what a file op's metadata is.
      const { path: _path, ...metadata } = value;
      found.push({
        filePath: value["path"],
        fieldPath: at,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
    }
    return;
  }
  if (schema.type === "object" && isObject(value)) {
    for (const [key, itemSchema] of Object.entries(schema.items)) {
      const child = value[key];
      if (child !== undefined) {
        walk(itemSchema, child, [...at, key], found);
      }
    }
    return;
  }
  if (schema.type === "array" && Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(schema.item, item, [...at, index.toString()], found);
    });
    return;
  }
  if (schema.type === "record" && isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      walk(schema.item, item, [...at, key], found);
    }
    return;
  }
  if (schema.type === "discriminated-union") {
    // Every variant is tried rather than narrowing first: this only collects
    // paths, so a variant that does not match simply contributes none, and
    // getting the narrowing wrong here would silently miss a file.
    for (const variant of schema.items) {
      walk(variant, value, at, found);
    }
  }
}

function isObject(value: JSONValue): value is { [key: string]: JSONValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fetch a file as it was at a commit, as a data URL ready for a `file` op.
 *
 * Binaries are restored by RE-UPLOADING them, not by pointing at the old bytes.
 * The bytes at a commit live in git at that commit, which the current branch
 * may no longer contain — the file could have been deleted since — so a restore
 * that only wrote the path would produce a value referring to a file that is
 * not there. Re-uploading puts the bytes back where the path expects them.
 */
export async function fetchFileAtCommit(
  apiBasePath: string,
  commitSha: string,
  filePath: string,
  remote: boolean,
): Promise<
  { status: "ok"; dataUrl: string } | { status: "error"; message: string }
> {
  const query = new URLSearchParams({ commit_sha: commitSha, path: filePath });
  if (remote) {
    query.set("remote", "true");
  }
  try {
    const res = await fetch(`${apiBasePath}/history/files?${query.toString()}`);
    if (!res.ok) {
      return {
        status: "error",
        message: `Could not read ${filePath} as it was at ${commitSha.slice(0, 7)}`,
      };
    }
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { status: "ok", dataUrl };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
