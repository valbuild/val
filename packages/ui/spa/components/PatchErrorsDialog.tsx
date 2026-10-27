import { useMemo, useState } from "react";
import { ModuleFilePath, PatchId, SourcePath, Internal } from "@valbuild/core";
import { TriangleAlert, Undo2 } from "lucide-react";
import {
  useAllPatchErrors,
  useDeletePatches,
  useProfilesByAuthorId,
  usePatchSets,
  useValMode,
} from "./ValProvider";
import { useNavigation } from "./ValRouter";
import { useValPortal } from "./ValPortalProvider";
import { Button } from "./designSystem/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./designSystem/dialog";
import { CopyableCodeBlock } from "./designSystem/CopyableCodeBlock";
import { ScrollArea } from "./designSystem/scroll-area";
import { relativeLocalDate } from "../utils/relativeLocalDate";
import { ValPath } from "./ValPath";

type ConflictingChange = {
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  message: string;
  author: string | null;
  createdAt: string | null;
  patchPath: string[] | null;
};

/**
 * Names the changes that cannot be applied, and offers the two things an editor
 * can actually do about them: remove the change, or send us a diagnosis.
 *
 * Publishing is refused while any of these exist, and until now the only signal
 * was a transient "Failed to publish changes" - so a single stale change could
 * block a whole team indefinitely with nothing to act on.
 */
export function PatchErrorsDialog() {
  const { patchErrors } = useAllPatchErrors();
  const { deletePatches } = useDeletePatches();
  const { navigate } = useNavigation();
  const profiles = useProfilesByAuthorId();
  const serializedPatchSets = usePatchSets();
  const portalContainer = useValPortal();
  const mode = useValMode();
  const [dismissed, setDismissed] = useState(false);

  const changes = useMemo(
    () =>
      collectConflictingChanges(
        patchErrors,
        "data" in serializedPatchSets ? serializedPatchSets.data : undefined,
      ),
    [patchErrors, serializedPatchSets],
  );

  const diagnosis = useMemo(
    () => JSON.stringify({ mode, changes }, null, 2),
    [mode, changes],
  );

  // Dismissal is per set of conflicts, not for the session. Otherwise closing
  // the dialog once hides it for every LATER conflict too, and the only
  // remaining signal is a disabled publish button - which is the state this
  // dialog exists to explain. React's documented "adjusting state when a prop
  // changes" pattern; the condition is false on the immediate re-render.
  const changeKey = changes.map((change) => change.patchId).join("|");
  const [dismissedFor, setDismissedFor] = useState(changeKey);
  if (dismissedFor !== changeKey) {
    setDismissedFor(changeKey);
    setDismissed(false);
  }

  if (changes.length === 0) {
    return null;
  }
  return (
    <Dialog
      open={!dismissed}
      onOpenChange={(open) => {
        setDismissed(!open);
      }}
    >
      <DialogContent container={portalContainer} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex gap-2 items-center">
            <TriangleAlert size={18} />
            <span>
              {changes.length} change{changes.length === 1 ? "" : "s"} cannot be
              applied
            </span>
          </DialogTitle>
          <DialogDescription>
            These changes conflict with newer ones, so they can no longer be
            applied to the content. Nothing can be published until they are
            removed. Removing a change discards only that edit.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[40vh]">
          <div className="flex flex-col gap-3">
            {changes.map((change) => (
              <div
                key={change.patchId}
                className="flex flex-col gap-2 p-3 rounded-md border border-border-primary"
              >
                <div className="text-sm">
                  {change.patchPath ? (
                    <ValPath
                      moduleFilePath={change.moduleFilePath}
                      patchPath={change.patchPath}
                    />
                  ) : (
                    <span>{change.moduleFilePath}</span>
                  )}
                </div>
                <div className="text-xs text-fg-secondary">
                  {[
                    change.author
                      ? (profiles[change.author]?.fullName ?? change.author)
                      : null,
                    change.createdAt
                      ? relativeLocalDate(new Date(), change.createdAt)
                      : null,
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </div>
                <div className="text-xs text-fg-error-primary">
                  {change.message}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      deletePatches([change.patchId]);
                    }}
                  >
                    <span className="flex gap-2 items-center">
                      <span>Remove change</span>
                      <Undo2 size={14} />
                    </span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDismissed(true);
                      navigate("/val/compare", {
                        scrollToPath: sourcePathOf(change),
                      });
                    }}
                  >
                    Review in compare
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
        <details>
          <summary className="text-xs cursor-pointer text-fg-secondary">
            Diagnosis for Val developers
          </summary>
          <CopyableCodeBlock code={diagnosis} />
        </details>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={() => {
              deletePatches(changes.map((change) => change.patchId));
            }}
          >
            Remove all {changes.length} and continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function sourcePathOf(change: ConflictingChange): SourcePath {
  if (!change.patchPath || change.patchPath.length === 0) {
    return change.moduleFilePath as string as SourcePath;
  }
  return Internal.joinModuleFilePathAndModulePath(
    change.moduleFilePath,
    Internal.patchPathToModulePath(change.patchPath),
  );
}

/**
 * Joins the failures (which only carry a patch id and a message) with the patch
 * metadata the studio already has, so a change can be named by field and author
 * rather than by uuid.
 */
/**
 * Typed FROM the hook rather than restating its shape: a hand-written
 * `{ message: string }` view still compiles (extra properties are allowed
 * structurally) but silently drifts from what the engine actually surfaces -
 * `source` was added to these entries without this signature noticing.
 */
type AllPatchErrors = ReturnType<typeof useAllPatchErrors>["patchErrors"];

function collectConflictingChanges(
  patchErrors: AllPatchErrors,
  patchSets:
    | {
        moduleFilePath: ModuleFilePath;
        patchPath: string[];
        patches: {
          patchId: PatchId;
          author: string | null;
          createdAt: string;
        }[];
      }[]
    | undefined,
): ConflictingChange[] {
  if (!patchErrors) {
    return [];
  }
  const metadataByPatchId = new Map<
    PatchId,
    { author: string | null; createdAt: string; patchPath: string[] }
  >();
  for (const patchSet of patchSets ?? []) {
    for (const patch of patchSet.patches) {
      metadataByPatchId.set(patch.patchId, {
        author: patch.author,
        createdAt: patch.createdAt,
        patchPath: patchSet.patchPath,
      });
    }
  }
  const changes: ConflictingChange[] = [];
  for (const [moduleFilePathS, errors] of Object.entries(patchErrors)) {
    if (!errors) {
      continue;
    }
    for (const [patchIdS, error] of Object.entries(errors)) {
      const patchId = patchIdS as PatchId;
      const metadata = metadataByPatchId.get(patchId);
      changes.push({
        patchId,
        moduleFilePath: moduleFilePathS as ModuleFilePath,
        message: error.message,
        author: metadata?.author ?? null,
        createdAt: metadata?.createdAt ?? null,
        patchPath: metadata?.patchPath ?? null,
      });
    }
  }
  return changes.sort((a, b) =>
    (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
  );
}
