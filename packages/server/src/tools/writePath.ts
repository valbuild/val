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
import type { Sources, ValOps } from "../ValOps";
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
  /** Applicable, but the result would not be publishable. */
  | { status: "invalid"; errors: string }
  /** The patch does not fit the content at all, so there is nothing to judge. */
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
  const after = await blockingErrorsIn(
    ops,
    state,
    speculativeSources,
    moduleFilePath,
  );
  if (after.length === 0) {
    return { status: "valid" };
  }

  // Only the errors this patch *introduces*. A module can already be broken for
  // reasons this change has nothing to do with -- the example app ships with a
  // missing image file -- and refusing on the total would make every such module
  // permanently read-only: an agent could not fix a typo in a file that also
  // holds a broken image reference. Paid for only when there is something to
  // refuse, so an ordinary clean edit still validates once.
  const before = await blockingErrorsIn(
    ops,
    state,
    state.sources,
    moduleFilePath,
  );
  const existing = new Set(before.map(identify));
  const introduced = after.filter((error) => !existing.has(identify(error)));
  if (introduced.length === 0) {
    return { status: "valid" };
  }
  return { status: "invalid", errors: describeErrors(introduced) };
}

type LocatedError = { path: SourcePath; message: string };

/** Path and message together: the same message at another path is another problem. */
function identify(error: LocatedError): string {
  return `${error.path}\u0000${error.message}`;
}

/**
 * The publishing-blocking errors in one module, for a given set of sources.
 *
 * Scoped to one module by source path, which starts with the module file path.
 * Errors elsewhere in the project are somebody else's: refusing on them would
 * let the first broken module in a repo make every other module read-only.
 */
async function blockingErrorsIn(
  ops: ValOps,
  state: ValToolState,
  sources: Sources,
  moduleFilePath: ModuleFilePath,
): Promise<LocatedError[]> {
  const validation = await ops.validateSources(
    state.schemas,
    sources,
    // Every module, deliberately -- `patchesByModule` is a FILTER on which
    // modules get validated, not context for validating them. Passing the
    // analysis from before this write skips the very module being written
    // whenever it had no pending patch, so the first change to a module went
    // unchecked; and a change that breaks a `keyOf` or a router in a *different*
    // module reports its error there, which a filtered run never visits.
    undefined,
  );
  // `validateSources` hands back the files it could not check on its own;
  // running them is what turns "this path holds a file" into "that file is
  // actually there and matches its recorded metadata".
  const fileErrors = await ops.validateFiles(
    state.schemas,
    sources,
    validation.files,
    state.analysis.fileLastUpdatedByPatchId,
  );

  // Merged rather than overwritten: a path can pick up an error from validation
  // and another from its file.
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
    sources,
  );
  const located: LocatedError[] = [];
  for (const [path, errors] of Object.entries(blocking)) {
    if (!path.startsWith(moduleFilePath)) {
      continue;
    }
    for (const error of errors) {
      located.push({ path: path as SourcePath, message: error.message });
    }
  }
  return located;
}

function describeErrors(errors: LocatedError[]): string {
  return errors.map((e) => `${e.path}: ${e.message}`).join("; ");
}

/**
 * What to do when the change would leave the content invalid.
 *
 * `"reject"` for a tool that is editing existing content: an agent should not be
 * able to break a site, and a rejected patch stores nothing.
 *
 * `"report"` for a tool whose whole purpose is to create something incomplete.
 * `empty_at_path` scaffolds an entry the caller is then expected to fill in, so
 * on most real schemas — anything with a non-empty string — the value it creates
 * is invalid by construction. Rejecting that would make the tool useless on
 * exactly the schemas it exists for, so instead the patch is saved and the
 * remaining errors come back as a to-do list. This mirrors the Studio, where
 * creating an empty entry is normal and the errors show until it is filled in.
 */
export type OnInvalid = "reject" | "report";

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
  onInvalid: OnInvalid = "reject",
): Promise<ValToolResult> {
  const { ops, ctx, state } = deps;

  const unapplied = state.unappliedPatches[moduleFilePath];
  if (unapplied && unapplied.length > 0) {
    // Refused before anything is validated, because the state to validate
    // against is wrong. `sources` for this module silently lacks these pending
    // changes, so a patch built on it would be based on content that will never
    // exist -- and its parent ref would chain onto changes that do not apply.
    return {
      status: "error",
      code: "internal",
      message: `Cannot write to ${moduleFilePath}: it has ${
        unapplied.length
      } pending change${
        unapplied.length === 1 ? "" : "s"
      } that will not apply, so what is stored is not what publishing would produce. Resolve or discard ${unapplied
        .map((u) => u.patchId)
        .join(", ")} first -- get_patches shows them.`,
    };
  }

  const speculative = await validateSpeculatively(
    ops,
    state,
    moduleFilePath,
    patch,
  );
  if (speculative.status === "unapplicable") {
    // Never negotiable: the patch does not fit the content, so there is nothing
    // to save whatever the caller's tolerance for invalid results.
    return speculative.result;
  }
  let unresolved: string | null = null;
  if (speculative.status === "invalid") {
    if (onInvalid === "reject") {
      return {
        status: "error",
        code: "validation-failed",
        message: `The change was rejected and nothing was saved, because it would leave the content invalid: ${speculative.errors}`,
      };
    }
    unresolved = speculative.errors;
  }

  /**
   * Null on the PAT path, and the verified profile on the token path.
   *
   * The PAT case is unchanged and still deliberate: the app cannot resolve a
   * PAT, so any id it wrote here would be an unverified claim dressed up as a
   * checked one — and the request already carries the caller's own token, which
   * is a better answer to "who did this" than anything the app could assert.
   * Attributing that patch is the backend's job.
   *
   * The token case is the opposite situation, which is why it gets the opposite
   * answer. The host verified a signature over a key it does not hold, so the
   * profile is checked rather than claimed, and the backend has no token of its
   * own to attribute from — the call reaches it under the app's API key. If this
   * stayed null, every edit made through a signed-in editor's own session would
   * land with no author at all, which is worse than useless on a CMS whose
   * review screen is organised by who changed what.
   */
  const authorId =
    ctx.auth?.type === "verified-profile" ? ctx.auth.profileId : null;
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
          // Always present, so a caller does not have to tell "absent" from
          // "nothing left to do" to know whether the content is publishable.
          unresolvedValidationErrors: unresolved,
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
