import { useMemo } from "react";
import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  useCommittedPatches,
  useProfilesByAuthorId,
} from "../components/ValProvider";
import { computeChangedSourcePaths } from "../utils/computeChangedSourcePaths";
import type { SerializedPatchSet } from "../utils/PatchSets";
import { useDescriptions } from "../components/useDescriptions";
import { navNodeId, toCompareStructure } from "./toCompareStructure";
import type { CompareModel, ComparePane } from "./types";

/**
 * The compare dialog's model, from the patch sets it is opened over.
 *
 * Thin, because everything that can be decided without a store is in
 * `toCompareStructure` — which nav section a module lands in, what a pane
 * holds, what counts as one change — and that half has the tests.
 *
 * `renderValue` is passed in rather than imported so this file stays free of
 * JSX: `CompareModel` carries `before`/`after` as `ReactNode`, and the caller
 * is the one that already knows it is inside React. `ReviewCompare` supplies
 * `CompareValue`.
 */
export function useCompareModel({
  patchSets,
  renderValue,
}: {
  patchSets: SerializedPatchSet;
  renderValue: (path: SourcePath, side: "before" | "after") => React.ReactNode;
}): CompareModel {
  const profiles = useProfilesByAuthorId();
  const committedPatchIds = useCommittedPatches();

  const structure = useMemo(
    () =>
      toCompareStructure(
        computeChangedSourcePaths(patchSets, committedPatchIds).trees,
      ),
    [patchSets, committedPatchIds],
  );

  /*
   * Every path the dialog names — the module headings and every row under
   * them. Resolved in one pass for the same reason the review page does it:
   * the count changes as edits land, so a hook per row is a hook in a loop.
   */
  const paths = useMemo<SourcePath[]>(() => {
    const seen: SourcePath[] = [];
    for (const pane of Object.values(structure.panes)) {
      seen.push(pane.moduleFilePath as unknown as SourcePath);
      for (const row of pane.rows) seen.push(row.sourcePath);
    }
    return seen;
  }, [structure]);
  const descriptions = useDescriptions(paths);

  return useMemo<CompareModel>(() => {
    const panes: Record<string, ComparePane> = {};
    for (const [nodeId, pane] of Object.entries(structure.panes)) {
      panes[nodeId] = {
        description: descriptions.describe(
          pane.moduleFilePath as unknown as SourcePath,
        ),
        path: pane.moduleFilePath,
        ...(pane.change ? { change: pane.change } : {}),
        groups: [
          {
            kind: "fields",
            id: `${nodeId}:fields`,
            rows: pane.rows.map((row) => ({
              id: row.id,
              label: row.label,
              change: row.change,
              /*
               * An added value did not exist before and a removed one does not
               * exist after. Rendering the side anyway would draw an empty
               * field, which reads as "this is blank now" rather than "this
               * was not here".
               */
              ...(row.change === "added"
                ? {}
                : { before: renderValue(row.sourcePath, "before") }),
              ...(row.change === "removed"
                ? {}
                : { after: renderValue(row.sourcePath, "after") }),
              authors: row.authors,
              /*
               * Everything here is pending — the dialog is opened over what is
               * about to be published — so undoing means DISCARDING the patch.
               * No schema question: the result is a state that already existed.
               */
              undo: { kind: "discard" as const },
            })),
          },
        ],
      };
    }
    return {
      sections: structure.sections,
      panes,
      changeCount: structure.changeCount,
      profiles,
      left: { label: "Published", caption: "What is live now" },
      right: {
        label: "After publish",
        caption: `${structure.changeCount} ${
          structure.changeCount === 1 ? "change" : "changes"
        }`,
      },
      /*
       * One basis: pending work against what is published.
       *
       * That is the whole story in fs mode rather than a missing feature — the
       * content host is a directory and `ValOpsFS` answers
       * `not-supported-in-fs-mode` for history, so there are no commits to
       * compare against. `BasisPicker` hides itself on a single option, so the
       * dialog opens there with no control that cannot narrow anything.
       *
       * In http mode there ARE commits, and comparing against one is the
       * restore flow — which lives on the history page, where the two-pane
       * view and the compatibility checks already are. Putting the same
       * mechanic behind a dropdown here would be a second way in that has to
       * agree with the first forever.
       */
      selectedBasisId: "published",
      basisOptions: [
        { id: "published", label: "Published", caption: "What is live now" },
      ],
      undo: { kind: "discard" },
    };
  }, [structure, descriptions, profiles, renderValue]);
}

/** The pane a nav node opens, for a caller that has a module path. */
export function paneIdOf(moduleFilePath: ModuleFilePath): string {
  return navNodeId(moduleFilePath);
}
