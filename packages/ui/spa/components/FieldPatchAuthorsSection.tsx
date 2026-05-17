import { SourcePath } from "@valbuild/core";
import { useMemo } from "react";
import { FieldPatchAuthors } from "./FieldPatchAuthors";
import {
  PendingPatch,
  usePendingPatches,
  useProfilesByAuthorId,
} from "./ValProvider";

export function FieldPatchAuthorsSection({ path }: { path: SourcePath }) {
  const pendingPatches = usePendingPatches(path);
  const profilesByAuthorIds = useProfilesByAuthorId();
  const patchesByAuthorIds = useMemo((): Record<string, PendingPatch[]> => {
    const byAuthors: Record<string, PendingPatch[]> = {};
    for (const patch of pendingPatches || []) {
      const author = patch.authorId ?? "unknown";
      if (!byAuthors[author]) {
        byAuthors[author] = [];
      }
      byAuthors[author].push(patch);
    }
    return byAuthors;
  }, [pendingPatches]);
  const hasPendingPatches = pendingPatches ? pendingPatches.length > 0 : false;
  if (!hasPendingPatches) return null;
  return (
    <FieldPatchAuthors
      patchesByAuthorIds={patchesByAuthorIds}
      profilesByAuthorIds={profilesByAuthorIds}
      sourcePath={path}
    />
  );
}
