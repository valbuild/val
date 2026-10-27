import { GitCompare } from "lucide-react";
import * as React from "react";
import type { SourcePath } from "@valbuild/core";
import { VAL_REVIEW_ROUTE } from "./ValRouter";
import { useNavLink } from "./navLink";
import { useCommittedPatches, usePatchSets } from "./ValProvider";
import { pendingPatchSets } from "../utils/computeChangedSourcePaths";
import { hasChangeAt } from "../review/reviewCompareParam";

/**
 * The review page's compare dialog, open on this file's change.
 *
 * Not the old `/val/compare` view: the dialog is the one that answers "what is
 * about to go out", and a link into it lands on the entry rather than on a
 * page you then have to scroll.
 *
 * Drawn only while the review page has the change to show, which is not the
 * same as the file having patches: in http mode a shipped patch stays in the
 * chain until the deploy moves the base, and the review page leaves those out
 * (`pendingPatchSets`). Tested with the review page's own predicate, so the
 * link and the page it opens cannot disagree. A component of its own so that
 * the patch sets are read only while a file with changes is open.
 */
export function CompareLink({ sourcePath }: { sourcePath: SourcePath }) {
  const patchSets = usePatchSets();
  const committedPatchIds = useCommittedPatches();
  const link = useNavLink(VAL_REVIEW_ROUTE, { compare: sourcePath });
  const pending = React.useMemo(
    () =>
      patchSets.status === "success"
        ? pendingPatchSets(patchSets.data, committedPatchIds)
        : null,
    [patchSets, committedPatchIds],
  );
  if (pending === null || !hasChangeAt(pending, sourcePath)) return null;
  return (
    <a
      {...link}
      className="inline-flex items-center gap-1.5 rounded-md bg-bg-secondary px-3 py-1.5 text-xs font-medium text-fg-primary transition-colors hover:bg-bg-tertiary"
    >
      <GitCompare size={14} />
      View in Compare
    </a>
  );
}
