import { useMemo } from "react";
import type { SourcePath } from "@valbuild/core";
import {
  useCurrentAuthorId,
  useProfilesByAuthorId,
} from "../components/ValProvider";
import { useValMode } from "../components/ValProvider";
import { usePatchStaging } from "../components/PatchStagingProvider";
import type { SerializedPatchSet } from "../utils/PatchSets";
import { useReviewDescriptions } from "./useReviewDescriptions";
import { reviewSourcePath, toReviewModel } from "./toReviewModel";
import type { ReviewModel } from "./types";

/**
 * The review page's model, from the stores.
 *
 * Thin on purpose: everything that can be decided without a store is in
 * `toReviewModel`, which is pure and tested. What is left here is gathering —
 * the patch sets, who is signed in, the staging state, and the names.
 *
 * Mounted UNDER `PatchStagingProvider`, which is what makes `staging` mean
 * anything: without it every row answers "staged" and the two sections are one.
 * `ReviewSurface` is the thing that guarantees the nesting.
 */
export function useReviewModel(patchSets: SerializedPatchSet): ReviewModel {
  const profiles = useProfilesByAuthorId();
  const currentAuthorId = useCurrentAuthorId();
  const mode = useValMode();
  const staging = usePatchStaging();

  /*
   * Every path this page names, in one list, so the descriptions can be
   * resolved in one pass rather than a hook per row. Module roots are in it
   * too: a group heading is a title surface like any other.
   */
  const paths = useMemo<SourcePath[]>(() => {
    const seen: SourcePath[] = [];
    const add = (path: SourcePath) => {
      if (!seen.includes(path)) seen.push(path);
    };
    for (const patchSet of patchSets) {
      add(patchSet.moduleFilePath as unknown as SourcePath);
      add(reviewSourcePath(patchSet));
    }
    return seen;
  }, [patchSets]);
  const descriptions = useReviewDescriptions(paths);

  /*
   * `now` is captured per model rather than per render: the rows show relative
   * dates ("12m ago"), and a `new Date()` inside the renderer would make every
   * row a new value on every render for no change anyone can see.
   */
  const now = useMemo(() => new Date(), [patchSets]);

  return useMemo(
    () =>
      toReviewModel({
        patchSets,
        profiles,
        mode,
        currentAuthorId,
        stagingEnabled: staging.enabled,
        stateOf: staging.stateOf,
        stagePreview: staging.stagePreview,
        authorOf: staging.authorOf,
        describe: (path) => descriptions.get(path) ?? fallbackDescription(path),
        now,
      }),
    [patchSets, profiles, mode, currentAuthorId, staging, descriptions, now],
  );
}

/**
 * Never reached in practice — every path this page names was in the list above
 * — but a `Description` is not optional and a row with no name cannot render.
 * The path's last segment is the name of last resort, which is what
 * `describePath` answers with when it has nothing else.
 */
function fallbackDescription(path: SourcePath) {
  const segments = path.split("?")[0].split("/");
  const label = segments[segments.length - 1] || path;
  return {
    title: label,
    subtitle: null,
    image: null,
    pathLabel: label,
    url: null,
    origin: {
      title: "fallback" as const,
      subtitle: "fallback" as const,
      image: "fallback" as const,
    },
  };
}
