import { useCallback, useId, useMemo, useSyncExternalStore } from "react";
import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SourcePath,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import type { CreatePatchResult } from "../PatchStore";
import type { SaveRejection, SyncState } from "../PatchSync";
import { useValSystem } from "./SystemContext";
import { useSourceAtPath, type SourceAtPath } from "./useSourceAtPath";

/**
 * Write at one path.
 *
 * Same shape as `ValFieldProvider`'s `useAddPatch(sourcePath, creatorId)`: it hands back the
 * patch path for the caller to build ops against, plus a way to apply them.
 *
 * ## `fieldId` defaults to this instance, and that is the point
 *
 * Suppression is per field INSTANCE, so the id passed to `createPatch` decides
 * which listener stays asleep. Defaulting it to `useId()` means a field that types
 * into itself is not woken by its own keystroke, while a second instance on the
 * same path — a studio field and an inline overlay — still is. The engine's
 * `creatorId` is optional and usually omitted, because the engine this replaced had no
 * per-instance suppression to feed.
 *
 * Passing `creatorId` explicitly is for the case where the writer is not the
 * component that should stay asleep: a toolbar acting on a field, say.
 *
 * ## There is no `addPatchAwaitable`
 *
 * The engine has one because `addPatch` is fire-and-forget into a sync queue, so a
 * caller that needs the patch id has to use a different method. Here
 * `createPatch` already returns its result — including the failure cases, which
 * are ordinary outcomes: an upload can fail before the patch exists.
 */
export function useAddPatch(
  sourcePath: SourcePath | ModuleFilePath,
  creatorId?: string,
): {
  /** The op path for this source path, ready to build `Patch` ops against. */
  patchPath: string[];
  moduleFilePath: ModuleFilePath;
  addPatch: (
    patch: Patch,
    meta?: Record<string, Json>,
  ) => Promise<CreatePatchResult>;
} {
  const val = useValSystem();
  const instanceId = useId();
  const fieldId = creatorId ?? instanceId;
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath as SourcePath);
  const patchPath = useMemo(
    () => Internal.createPatchPath(modulePath),
    [modulePath],
  );

  const addPatch = useCallback(
    async (
      patch: Patch,
      meta?: Record<string, Json>,
    ): Promise<CreatePatchResult> => {
      if (val === null) {
        return {
          status: "upload-failed",
          message:
            "Cannot write: this component is not inside a ValSystemProvider.",
          rolledBack: [],
          orphaned: [],
        };
      }
      return val.system.patchStore.createPatch(
        moduleFilePath,
        patch,
        meta,
        fieldId,
      );
    },
    [val, moduleFilePath, fieldId],
  );

  return { patchPath: [...patchPath], moduleFilePath, addPatch };
}

const IN_SYNC: SyncState = { status: "in-sync" };
const noopSubscribe = () => () => {};

/**
 * Whether local edits have reached the server, and the last refusal.
 *
 * Two values rather than one, because they answer different questions and neither
 * can stand in for the other. `state` is the QUEUE — in-sync, pending, saving,
 * retrying — and after a rejection it correctly reads `in-sync`, since the
 * refused patches were dropped and nothing is waiting. `rejection` is the
 * refusal, and it is sticky until acknowledged, because the queue going quiet is
 * exactly when a UI would otherwise lose the one outcome that destroyed an edit.
 * See `PatchSync`.
 */
export function useSyncStatus(): {
  state: SyncState;
  rejection: SaveRejection | null;
  acknowledgeRejection: () => void;
} {
  const val = useValSystem();

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) {
        return () => {};
      }
      // Two events, and both are needed.
      //
      // `patch:sync-state` covers every queue transition, including the ones no
      // outcome event accompanies: a system with no write seam sets `pending` and
      // emits nothing else at all, so subscribing to the outcome events alone
      // reported every unsaved edit as in-sync. That was this hook's first bug and
      // the reason the store now announces its state.
      //
      // `patch:save-rejected` is separate because a rejection is NOT a queue
      // state: the refused patches were dropped, so the queue correctly goes
      // quiet, and the sticky rejection is the only remaining record of the one
      // outcome that destroyed an edit.
      const offs = [
        val.system.patchSync.events.on("patch:sync-state", onChange),
        val.system.patchSync.events.on("patch:save-rejected", onChange),
      ];
      return () => {
        for (const off of offs) off();
      };
    },
    [val],
  );

  const getState = useCallback(() => {
    if (val === null) {
      return IN_SYNC;
    }
    return val.system.patchSync.currentState();
  }, [val]);

  const state = useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getState,
    getState,
  );

  const getRejection = useCallback(() => {
    if (val === null) {
      return null;
    }
    return val.system.patchSync.lastRejection();
  }, [val]);

  const rejection = useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getRejection,
    getRejection,
  );

  const acknowledgeRejection = useCallback(() => {
    val?.system.patchSync.clearRejection();
  }, [val]);

  return { state, rejection, acknowledgeRejection };
}

/**
 * Everything one field needs, sharing ONE instance id.
 *
 * This is the hook a field should use, and it exists because the alternative is a
 * rule nobody can be expected to keep: `useId()` returns a different value per
 * hook call, so a component that calls `useSourceAtPath` and `useAddPatch`
 * separately registers its listener under one id and writes under another — and
 * per-instance suppression, which compares exactly those two, silently stops
 * working. The field is then woken by its own keystroke, which is the bug the
 * whole mechanism exists to prevent, and nothing anywhere reports it.
 *
 * So the id is created once here and handed to both.
 */
export function useValField(sourcePath: SourcePath | ModuleFilePath): {
  fieldId: string;
  source: SourceAtPath;
  patchPath: string[];
  addPatch: (
    patch: Patch,
    meta?: Record<string, Json>,
  ) => Promise<CreatePatchResult>;
} {
  const fieldId = useId();
  const source = useSourceAtPath(sourcePath, fieldId);
  const { patchPath, addPatch } = useAddPatch(sourcePath, fieldId);
  return { fieldId, source, patchPath, addPatch };
}
