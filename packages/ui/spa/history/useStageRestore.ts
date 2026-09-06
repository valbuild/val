import {
  Internal,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import type { JSONValue, Patch } from "@valbuild/core/patch";
import { useCallback, useState } from "react";
import { useAddPatch } from "../components/ValFieldProvider";
import {
  buildRestorePatch,
  collectMedia,
  fetchFileAtCommit,
  moduleFilePathOf,
} from "./stageRestore";

export type StageState =
  | { status: "idle" }
  | { status: "staging" }
  | { status: "staged" }
  | { status: "error"; message: string };

/**
 * Stage a restore: put an old value where someone pointed, as a pending change.
 *
 * Staged rather than applied, which is the whole posture of this feature. A
 * restore is an edit — it goes into pending changes, it is reviewed beside
 * every other edit, and it publishes with them. Writing it straight to the
 * branch would make restore the one action in the Studio that skipped the step
 * where you look at what you did.
 */
export function useStageRestore(
  to: SourcePath | null,
  apiBasePath: string,
): {
  state: StageState;
  stage: (args: {
    commitSha: string;
    value: JSONValue;
    schema: SerializedSchema;
  }) => Promise<void>;
  reset: () => void;
} {
  const [state, setState] = useState<StageState>({ status: "idle" });
  const { addAndUploadPatchWithFileOps, addModuleFilePatch } = useAddPatch(
    to ?? ("" as SourcePath),
  );

  const stage = useCallback(
    async ({
      commitSha,
      value,
      schema,
    }: {
      commitSha: string;
      value: JSONValue;
      schema: SerializedSchema;
    }) => {
      if (!to) {
        return;
      }
      setState({ status: "staging" });
      const patch: Patch = buildRestorePatch(to, value);

      /*
       * Binaries come back by re-upload, not by reference.
       *
       * The bytes at a commit are in git AT THAT COMMIT, which the current
       * branch may no longer contain — the file could have been deleted since.
       * A restore that wrote only the path would produce a value pointing at a
       * file that is not there, which looks like a successful restore and is
       * not one. So the bytes are fetched from the commit and uploaded again,
       * under the same path, which is where the restored value expects them.
       */
      const media = collectMedia(schema, value);
      const fileOps: Patch = [];
      const basePath = Internal.createPatchPath(
        Internal.splitModuleFilePathAndModulePath(to)[1],
      );
      for (const { filePath, fieldPath, metadata } of media) {
        const remote = !filePath.startsWith("/public");
        const fetched = await fetchFileAtCommit(
          apiBasePath,
          commitSha,
          filePath,
          remote,
        );
        if (fetched.status === "error") {
          setState({ status: "error", message: fetched.message });
          return;
        }
        fileOps.push({
          op: "file",
          /*
           * The MEDIA FIELD's path, not the restore target's.
           *
           * The server injects a draft `patch_id` at `op.path` — literally
           * `op.path.concat(nestedFilePath).concat("patch_id")` — so pointing
           * every file op at the target meant an object restore carrying a
           * nested image put the patch id on the object, and the draft URL for
           * that image never resolved.
           */
          path: [...basePath, ...fieldPath],
          filePath,
          value: fetched.dataUrl,
          remote,
          /*
           * What the field says the bytes are. Every other file op carries
           * this, and commit-time validation reports `image:check-metadata`
           * against the field when a stored value's dimensions disagree with
           * its file — so the op should state what the value claims rather than
           * rely on the two happening to agree.
           */
          ...(metadata ? { metadata } : {}),
        });
      }

      if (fileOps.length > 0) {
        await addAndUploadPatchWithFileOps(
          [...patch, ...fileOps],
          // The subtype only decides how the store labels the upload; a restore
          // can carry either, and "file" is the one that makes no claim.
          "file",
          (message) => setState({ status: "error", message }),
          () => {},
        );
        setState({ status: "staged" });
        return;
      }

      addModuleFilePatch(moduleFilePathOf(to), patch, "object");
      setState({ status: "staged" });
    },
    [to, apiBasePath, addAndUploadPatchWithFileOps, addModuleFilePatch],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { state, stage, reset };
}
