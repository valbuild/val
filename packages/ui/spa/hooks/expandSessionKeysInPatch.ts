import {
  FILE_REF_SUBTYPE_TAG,
  VAL_EXTENSION,
  type ImageMetadata,
  type PatchId,
  type SerializedSchema,
  type Source,
} from "@valbuild/core";
import { Patch } from "@valbuild/shared/internal";
import type { ToolName } from "../utils/toolNames";
import {
  buildFileRefValue,
  getInlineImgInfo,
  isRemoteSchema,
  resolveSerializedSchemaAtPath,
} from "./aiImageToolPatches";

/**
 * Sentinel value an LLM can place in a `create_patch` payload anywhere it
 * would normally write a FileSource/ImageSource. The client transfers the
 * underlying session-uploaded files via `aiSessionImagesToPatchFile` and rewrites
 * the patch to reference the resulting on-disk file.
 *
 * `_type: "ai_session_file"` is what makes this unambiguous against an actual
 * FileSource/ImageSource (which use `_type: "file"`).
 */
export type SessionKey = {
  readonly key: string;
  readonly filePath: string;
  readonly [VAL_EXTENSION]: "ai_session_file";
  readonly [FILE_REF_SUBTYPE_TAG]: "image" | "file";
  readonly alt?: string;
  readonly hotspot?: { readonly x: number; readonly y: number };
};

export function isSessionKey(v: unknown): v is SessionKey {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o[VAL_EXTENSION] !== "ai_session_file") return false;
  if (o[FILE_REF_SUBTYPE_TAG] !== "image" && o[FILE_REF_SUBTYPE_TAG] !== "file")
    return false;
  if (typeof o.key !== "string") return false;
  if (typeof o.filePath !== "string") return false;
  return true;
}

export type PendingTransfer = {
  readonly siteId: number;
  readonly key: string;
  readonly filePath: string;
  readonly isRemote: boolean;
};

export type PlanResult =
  | {
      kind: "ok";
      transfers: PendingTransfer[];
      apply: (
        metadataBySiteId: Record<number, ImageMetadata | undefined>,
      ) => ApplyResult;
    }
  | { kind: "wrong-tool"; suggestedTool: ToolName; reason: string }
  | { kind: "error"; message: string };

export type ApplyResult =
  | { kind: "ok"; patch: Patch }
  | { kind: "error"; message: string };

type LeafSite = {
  kind: "leaf";
  opIndex: number;
  opPath: string[];
  subtype: "image" | "file";
  remote: boolean;
  sessionKey: SessionKey;
};

type InlineImgSite = {
  kind: "inline-img";
  opIndex: number;
  opPath: string[];
  // Path from op.value down to the SessionKey, ending with "src".
  // This is also the `nestedFilePath` used in the appended `file` op.
  valuePath: string[];
  remote: boolean;
  sessionKey: SessionKey;
};

type Site = LeafSite | InlineImgSite;

function deepCloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function setAt(
  root: unknown,
  path: string[],
  value: unknown,
): { ok: true } | { ok: false; reason: string } {
  if (path.length === 0) {
    return { ok: false, reason: "cannot set at empty path" };
  }
  let cur: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    const part = path[i];
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
        return {
          ok: false,
          reason: `index out of bounds at ${path.slice(0, i + 1).join("/")}`,
        };
      }
      cur = cur[idx];
    } else if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return {
        ok: false,
        reason: `cannot descend into non-object at ${path.slice(0, i + 1).join("/")}`,
      };
    }
  }
  const last = path[path.length - 1];
  if (Array.isArray(cur)) {
    const idx = Number(last);
    if (!Number.isInteger(idx)) {
      return {
        ok: false,
        reason: `expected numeric index at ${path.join("/")}`,
      };
    }
    cur[idx] = value;
    return { ok: true };
  }
  if (cur && typeof cur === "object") {
    (cur as Record<string, unknown>)[last] = value;
    return { ok: true };
  }
  return { ok: false, reason: `cannot set on non-object at ${path.join("/")}` };
}

/**
 * Walk an arbitrary JSON value, calling `onSessionKey` for every SessionKey
 * found inside an `{tag:"img", src: <SessionKey>}` node, and `onForbidden`
 * for any SessionKey found outside such a slot.
 */
function walkRichtextValueForSessionKeys(
  root: unknown,
  onImgSrc: (sessionKey: SessionKey, valuePath: string[]) => void,
  onForbidden: (valuePath: string[]) => void,
): void {
  const visit = (node: unknown, path: string[]): void => {
    if (isSessionKey(node)) {
      onForbidden(path);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, [...path, String(i)]));
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (obj.tag === "img" && isSessionKey(obj.src)) {
        // Validate other fields don't contain SessionKeys
        for (const [k, v] of Object.entries(obj)) {
          if (k === "src") continue;
          visit(v, [...path, k]);
        }
        onImgSrc(obj.src as SessionKey, [...path, "src"]);
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        visit(v, [...path, k]);
      }
    }
  };
  visit(root, []);
}

/**
 * Find every SessionKey that appears anywhere inside a value (used to detect
 * forbidden placements at non-richtext, non-leaf schemas).
 */
function valueContainsSessionKey(node: unknown): boolean {
  if (isSessionKey(node)) return true;
  if (Array.isArray(node)) return node.some(valueContainsSessionKey);
  if (node && typeof node === "object") {
    return Object.values(node as Record<string, unknown>).some(
      valueContainsSessionKey,
    );
  }
  return false;
}

function mergeMetadata(
  serverMetadata: ImageMetadata | undefined,
  sessionKey: SessionKey,
): ImageMetadata {
  const merged: ImageMetadata = serverMetadata
    ? { ...serverMetadata }
    : ({} as ImageMetadata);
  if (sessionKey[FILE_REF_SUBTYPE_TAG] === "image") {
    if (sessionKey.alt !== undefined) merged.alt = sessionKey.alt;
    if (sessionKey.hotspot !== undefined) merged.hotspot = sessionKey.hotspot;
  }
  return merged;
}

/**
 * Pure synchronous planner. Walks a parsed patch + the module schema, returns
 * either a `wrong-tool` / `error` result, or an `ok` plan describing the
 * SessionKey transfers needed and a closure that produces the rewritten patch
 * once the transfer metadata is supplied.
 *
 * The empty-`transfers` case is the idempotent fast path: the patch had no
 * SessionKeys; `apply({})` returns the input patch unchanged.
 */
export function planSessionKeyExpansion(args: {
  patch: Patch;
  moduleSchema: SerializedSchema;
  moduleSource: Source | undefined;
}): PlanResult {
  const { patch, moduleSchema } = args;
  const sites: Site[] = [];

  for (let opIndex = 0; opIndex < patch.length; opIndex++) {
    const op = patch[opIndex];
    if (op.op === "file") {
      return {
        kind: "error",
        message: `Patch op #${opIndex} is a 'file' op — those are emitted by the system, not by create_patch input.`,
      };
    }
    if (op.op === "remove" || op.op === "move" || op.op === "copy") {
      // No `value` to inspect — nothing to do here.
      continue;
    }
    if (op.op === "test") {
      if (valueContainsSessionKey(op.value)) {
        return {
          kind: "error",
          message: `Patch op #${opIndex} ('test') cannot contain a SessionKey.`,
        };
      }
      continue;
    }

    // op.op is "add" or "replace".
    const opPath = op.path as string[];
    const resolved = resolveSerializedSchemaAtPath(moduleSchema, opPath);
    if (resolved.kind === "unresolved") {
      // Pass through — the patch validator downstream will surface the path
      // error. Only complain if a SessionKey was placed somewhere unreachable.
      if (valueContainsSessionKey(op.value)) {
        return {
          kind: "error",
          message: `Patch op #${opIndex} contains a SessionKey but the path ${JSON.stringify(opPath)} could not be resolved against the module schema.`,
        };
      }
      continue;
    }

    if (resolved.kind === "gallery-traversed") {
      if (valueContainsSessionKey(op.value)) {
        return {
          kind: "wrong-tool",
          suggestedTool: "add_session_image_to_gallery",
          reason: `Patch op #${opIndex} targets an images gallery (s.images()) with a SessionKey. Galleries use file paths as keys; use add_session_image_to_gallery instead.`,
        };
      }
      continue;
    }

    if (resolved.kind === "leaf") {
      const leafSchema = resolved.schema;
      const valueIsSessionKey = isSessionKey(op.value);

      if (leafSchema.type === "image" || leafSchema.type === "file") {
        if (valueIsSessionKey) {
          const sk = op.value as SessionKey;
          if (sk[FILE_REF_SUBTYPE_TAG] !== leafSchema.type) {
            return {
              kind: "error",
              message: `Patch op #${opIndex}: SessionKey _tag is '${sk[FILE_REF_SUBTYPE_TAG]}' but the schema is '${leafSchema.type}'.`,
            };
          }
          sites.push({
            kind: "leaf",
            opIndex,
            opPath,
            subtype: leafSchema.type,
            remote: isRemoteSchema(leafSchema),
            sessionKey: sk,
          });
          continue;
        }
        // Non-SessionKey value at an image/file leaf — pass through, but
        // forbid SessionKeys nested inside (they have nowhere to live here).
        if (valueContainsSessionKey(op.value)) {
          return {
            kind: "error",
            message: `Patch op #${opIndex}: SessionKey nested inside a non-SessionKey value at an ${leafSchema.type} field. Place the SessionKey directly as the value.`,
          };
        }
        continue;
      }

      // Leaf is something other than image/file/richtext (string/number/...).
      if (valueContainsSessionKey(op.value)) {
        return {
          kind: "error",
          message: `Patch op #${opIndex}: SessionKey is not allowed at a '${leafSchema.type}' field.`,
        };
      }
      continue;
    }

    // resolved.kind === "richtext"
    const inlineImg = getInlineImgInfo(resolved.schema);
    let foundSiteCount = 0;
    let forbiddenAt: string[] | null = null;
    walkRichtextValueForSessionKeys(
      op.value,
      (sk, valuePath) => {
        sites.push({
          kind: "inline-img",
          opIndex,
          opPath,
          valuePath,
          remote: inlineImg.kind === "allowed" ? inlineImg.remote : false,
          sessionKey: sk,
        });
        foundSiteCount += 1;
      },
      (valuePath) => {
        if (forbiddenAt === null) forbiddenAt = valuePath;
      },
    );
    if (forbiddenAt) {
      return {
        kind: "error",
        message: `Patch op #${opIndex}: SessionKey at value path ${JSON.stringify(forbiddenAt)} is not inside a {tag:"img", src: ...} node.`,
      };
    }
    if (foundSiteCount > 0 && inlineImg.kind === "not-allowed") {
      return {
        kind: "error",
        message: `Patch op #${opIndex} inserts an inline image into a richtext that does not allow inline images (options.inline.img is not enabled).`,
      };
    }
  }

  const transfers: PendingTransfer[] = sites.map((s, siteId) => ({
    siteId,
    key: s.sessionKey.key,
    filePath: s.sessionKey.filePath,
    isRemote: s.remote,
  }));

  const apply = (
    metadataBySiteId: Record<number, ImageMetadata | undefined>,
  ): ApplyResult => {
    if (sites.length === 0) {
      return { kind: "ok", patch };
    }
    const cloned: unknown[] = patch.map((op) => deepCloneJson(op));
    const fileOps: unknown[] = [];

    for (let siteId = 0; siteId < sites.length; siteId++) {
      const site = sites[siteId];
      const metadata = mergeMetadata(metadataBySiteId[siteId], site.sessionKey);
      const subtype: "image" | "file" =
        site.kind === "leaf" ? site.subtype : "image";
      const refValue = buildFileRefValue(
        site.sessionKey.filePath,
        metadata as unknown as Record<string, unknown>,
        subtype,
      );

      if (site.kind === "leaf") {
        const opObj = cloned[site.opIndex] as { value: unknown };
        opObj.value = refValue;
        fileOps.push({
          op: "file",
          path: site.opPath,
          filePath: site.sessionKey.filePath,
          value: site.sessionKey.key,
          remote: site.remote,
          metadata,
        });
      } else {
        const opObj = cloned[site.opIndex] as { value: unknown };
        if (site.valuePath.length === 0) {
          opObj.value = refValue;
        } else {
          const setRes = setAt(opObj.value, site.valuePath, refValue);
          if (!setRes.ok) {
            return {
              kind: "error",
              message: `Failed to rewrite SessionKey at op #${site.opIndex}, value path ${JSON.stringify(site.valuePath)}: ${setRes.reason}`,
            };
          }
        }
        fileOps.push({
          op: "file",
          path: site.opPath,
          nestedFilePath: site.valuePath,
          filePath: site.sessionKey.filePath,
          value: site.sessionKey.key,
          remote: site.remote,
          metadata,
        });
      }
    }

    const finalPatch = [...cloned, ...fileOps];
    const parsed = Patch.safeParse(finalPatch);
    if (!parsed.success) {
      return {
        kind: "error",
        message: `Rewritten patch failed schema validation: ${JSON.stringify(parsed.error)}`,
      };
    }
    return { kind: "ok", patch: parsed.data };
  };

  return { kind: "ok", transfers, apply };
}

export type SessionKeyTransfer = (args: {
  patchId: PatchId;
  files: { filePath: string; key: string; isRemote: boolean }[];
}) => Promise<{
  patchId: PatchId;
  files: { filePath: string; metadata: ImageMetadata }[];
}>;

export type ExpandResult =
  | { kind: "ok"; patch: Patch }
  | { kind: "wrong-tool"; suggestedTool: ToolName; reason: string }
  | { kind: "error"; message: string };

/**
 * Async wrapper used by the create_patch handler. Idempotent: when the input
 * patch contains no SessionKeys, no transfers are made and the patch is
 * returned unchanged. Errors from `transfer` (including
 * SessionImageToPatchError) propagate to the caller.
 *
 * All transfers are batched into a single call. Duplicate `(filePath, key,
 * isRemote)` triples in the patch are deduped on the wire and the upstream
 * metadata is fanned back out to every site that referenced them.
 */
export async function expandSessionKeysInPatch(args: {
  patch: Patch;
  moduleSchema: SerializedSchema;
  moduleSource: Source | undefined;
  patchId: PatchId;
  transfer: SessionKeyTransfer;
}): Promise<ExpandResult> {
  const plan = planSessionKeyExpansion({
    patch: args.patch,
    moduleSchema: args.moduleSchema,
    moduleSource: args.moduleSource,
  });
  if (plan.kind !== "ok") return plan;

  const metadataBySiteId: Record<number, ImageMetadata | undefined> = {};
  if (plan.transfers.length > 0) {
    type FileKey = string;
    const keyOf = (t: {
      filePath: string;
      key: string;
      isRemote: boolean;
    }): FileKey => `${t.isRemote ? "1" : "0"} ${t.filePath} ${t.key}`;
    const dedupedFiles: {
      filePath: string;
      key: string;
      isRemote: boolean;
    }[] = [];
    const indexByKey = new Map<FileKey, number>();
    for (const t of plan.transfers) {
      const k = keyOf(t);
      if (indexByKey.has(k)) continue;
      indexByKey.set(k, dedupedFiles.length);
      dedupedFiles.push({
        filePath: t.filePath,
        key: t.key,
        isRemote: t.isRemote,
      });
    }
    const res = await args.transfer({
      patchId: args.patchId,
      files: dedupedFiles,
    });
    if (res.files.length !== dedupedFiles.length) {
      return {
        kind: "error",
        message: `Session image transfer returned ${res.files.length} results for ${dedupedFiles.length} files.`,
      };
    }
    for (const t of plan.transfers) {
      const idx = indexByKey.get(keyOf(t));
      if (idx === undefined) {
        return {
          kind: "error",
          message: `Internal error: missing transfer index for site ${t.siteId}.`,
        };
      }
      metadataBySiteId[t.siteId] = res.files[idx].metadata;
    }
  }

  const applied = plan.apply(metadataBySiteId);
  if (applied.kind === "error") {
    return { kind: "error", message: applied.message };
  }
  return { kind: "ok", patch: applied.patch };
}
