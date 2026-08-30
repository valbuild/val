import { randomUUID } from "node:crypto";
import type {
  ModuleFilePath,
  PatchId,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import {
  JSONOps,
  applyPatch,
  deepClone,
  type Operation,
  type Patch,
  type ParentRef,
  type ReadonlyJSONValue,
  type JSONValue,
} from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import { filterBlockingValidationErrors } from "@valbuild/shared/internal";
import type { ValOps } from "../ValOps";
import type { ValToolDeps, ValToolState } from "./defineTool";
import type { ValToolResult } from "./types";

/**
 * Everything the Studio does client-side before a patch can be saved, done
 * server-side.
 *
 * Three things had no server equivalent, and each is a way to be quietly wrong:
 * where the patch id comes from, what the patch says its parent is, and whether
 * the result would even be valid. `docs/plans/mcp.md` Part C is the design.
 */

const jsonOps = new JSONOps();

/**
 * A patch id, minted before the write is attempted.
 *
 * Same shape the Studio mints (a v4 UUID), and minting one that never gets used
 * costs nothing — ids are not registered anywhere until a patch carries them.
 */
export function mintPatchId(): PatchId {
  // A branded string has no constructor; this is the same conversion the Studio
  // and ValServer both make.
  return randomUUID() as PatchId;
}

/**
 * What the new patch should hang off.
 *
 * The last known patch if there is one, otherwise the current head. Note the
 * asymmetry between the two backends: `ValOpsFS` ignores `parentRef` entirely
 * because its append-only ordering log defines order, while `ValOpsHttp` sends
 * it up as `parentPatchId` for optimistic concurrency. So a wrong value here is
 * invisible locally and a conflict in production — which is why this is derived
 * fresh rather than remembered.
 */
export async function deriveParentRef(
  ops: ValOps,
  // Only the ids matter, so this accepts either shape `fetchPatches` can
  // return — the metadata-only variant omits the ops but keeps the ids.
  patches: { patches: readonly { patchId: PatchId }[] },
): Promise<ParentRef> {
  const last = patches.patches[patches.patches.length - 1];
  if (last) {
    return { type: "patch", patchId: last.patchId };
  }
  return { type: "head", headBaseSha: await ops.getBaseSha() };
}

/**
 * Would this patch leave the content valid?
 *
 * Applied to a **clone** of the sources, never the real ones: `applyPatch`
 * mutates the document it is given, and ValOps carries a standing note that
 * add operations misbehave without a clone. Validating in place would corrupt
 * the sources every later call in this process reads.
 *
 * Server-side this is strictly better than the Studio's speculative check.
 * `getSchemas()` returns real `Schema` instances, so the user's own `validate`
 * closures run — and those are not carried by the serialized schema the browser
 * has, which means the browser cannot run them at all.
 */
export async function validateSpeculatively(
  ops: ValOps,
  state: ValToolState,
  moduleFilePath: ModuleFilePath,
  patch: Patch,
): Promise<
  | { status: "valid" }
  | { status: "invalid"; result: ValToolResult }
  | { status: "unapplicable"; result: ValToolResult }
> {
  const current = state.sources[moduleFilePath];
  if (current === undefined) {
    return {
      status: "unapplicable",
      result: {
        status: "error",
        code: "not-found",
        message: `No Val module at ${JSON.stringify(moduleFilePath)}.`,
      },
    };
  }

  const applied = applyPatch(
    deepClone(current as ReadonlyJSONValue) as JSONValue,
    jsonOps,
    patch as Operation[],
  );
  if (result.isErr(applied)) {
    return {
      status: "unapplicable",
      result: {
        status: "error",
        code: "invalid-args",
        message: `The patch cannot be applied to ${moduleFilePath}: ${applied.error.message}`,
      },
    };
  }

  const speculativeSources = {
    ...state.sources,
    [moduleFilePath]: applied.value,
  };
  const validation = await ops.validateSources(
    state.schemas,
    speculativeSources,
    state.analysis.patchesByModule,
  );
  const fileErrors = await ops.validateFiles(
    state.schemas,
    speculativeSources,
    validation.files,
    state.analysis.fileLastUpdatedByPatchId,
  );

  const bySourcePath: Record<SourcePath, ValidationError[]> = {};
  const add = (path: SourcePath, errors: ValidationError[]) => {
    bySourcePath[path] = (bySourcePath[path] ?? []).concat(errors);
  };
  for (const moduleErrors of Object.values(validation.errors)) {
    for (const [path, errors] of Object.entries(
      moduleErrors.validations ?? {},
    )) {
      add(path as SourcePath, errors);
    }
  }
  for (const [path, errors] of Object.entries(fileErrors)) {
    add(path as SourcePath, errors);
  }

  const blocking = filterBlockingValidationErrors(
    bySourcePath,
    state.serializedSchemas,
    speculativeSources,
  );
  // Only errors this patch's own module is responsible for. A pre-existing
  // error elsewhere in the project must not block an unrelated edit, or the
  // first broken module in a repo would make the whole project read-only.
  const mine = Object.entries(blocking).filter(([path]) =>
    path.startsWith(moduleFilePath),
  );
  if (mine.length > 0) {
    return {
      status: "invalid",
      result: {
        status: "error",
        code: "validation-failed",
        message: `The change was rejected and nothing was saved, because it would leave the content invalid: ${mine
          .map(
            ([path, errors]) =>
              `${path}: ${errors.map((e) => e.message).join(", ")}`,
          )
          .join("; ")}`,
      },
    };
  }
  return { status: "valid" };
}

/**
 * Validate, then save — and retry once if someone else got there first.
 *
 * The retry exists because the parent ref is derived from a read that happened
 * before the write. A conflict means the chain moved underneath us, and
 * re-deriving is usually enough. Once only: a loop here would be an agent
 * fighting a human editor in the Studio, and losing slowly is worse than
 * failing clearly.
 */
export async function savePatch(
  deps: ValToolDeps,
  moduleFilePath: ModuleFilePath,
  patch: Patch,
): Promise<ValToolResult> {
  const { ops, ctx, state } = deps;

  const speculative = await validateSpeculatively(
    ops,
    state,
    moduleFilePath,
    patch,
  );
  if (speculative.status !== "valid") {
    return speculative.result;
  }

  const authorId = ctx.auth?.authorId ?? null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const patchId = mintPatchId();
    // Re-derived on the retry rather than reused: reusing the ref that just
    // conflicted would conflict again by definition.
    const patches =
      attempt === 0
        ? state.patches
        : await ops.fetchPatches({ excludePatchOps: true });
    const parentRef = await deriveParentRef(ops, patches);

    const saved = await ops.createPatch(
      moduleFilePath,
      patch,
      patchId,
      parentRef,
      ctx.sessionId,
      authorId,
    );
    if (result.isOk(saved)) {
      return {
        status: "ok",
        data: {
          patchId: saved.value.patchId,
          moduleFilePath,
          createdAt: saved.value.createdAt,
        },
      };
    }
    if (saved.error.errorType === "patch-head-conflict") {
      continue;
    }
    return {
      status: "error",
      code: "internal",
      // Note the nesting: createPatch wraps the underlying flat error as
      // `{ errorType: "other", error: <that> }`.
      message: saved.error.error.message,
    };
  }

  return {
    status: "error",
    code: "conflict",
    message:
      "Another change was saved while this one was being written, twice in a row. Read the content again before retrying — it has moved.",
  };
}
