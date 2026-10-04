import { useMemo, useRef } from "react";
import type { SourcePath } from "@valbuild/core";
import { useValSystem } from "../../../stores/react/SystemContext";
import { useChainVersion } from "../../ValProvider";
import { mergeRetainedPaths } from "./retainedCanvasPaths";

type RetainedCanvasPaths = {
  /** What the "On this page" column lists. */
  paths: readonly SourcePath[];
  /** The listed paths the page is not showing: kept, not reported. */
  offPage: ReadonlySet<SourcePath>;
};

type Memory = {
  resetKey: string;
  listed: readonly SourcePath[];
  /** Every listed path the editor has selected since the last reset. */
  workedOn: Set<SourcePath>;
};

const NONE: ReadonlySet<SourcePath> = new Set();

/**
 * The column's fields: what the page reports, and the ones the editor worked on
 * that the page has since stopped showing.
 *
 * A field is kept from the moment it is selected — focusing its input in the
 * column, or picking it on the page — because that is the field someone is
 * about to empty. It stays, in the place it was, until one of three things:
 *
 * - **It is gone from the content**, not just from the page: an array item
 *   that was removed, a record key that was renamed. The page stopped showing
 *   it because there is nothing to show, and a row for it could only say
 *   "not found". `peek` says `absent` for exactly that, and nothing else — an
 *   empty string, an empty list and `null` are all values.
 * - **The canvas moves to another route.** What was kept was kept for a page.
 * - **The editor reloads the page**, with the reload button. That is asking to
 *   see the page as it is now, and "as it is now" does not include what it
 *   stopped showing. Only the BUTTON: a page that re-renders itself after an
 *   edit must not drop the field being edited, which is the whole point.
 *
 * `resetKey` carries the last two. Only paths that were in the column are ever
 * kept: the selection can be a whole page or a module, which the page never
 * reports and the column never lists.
 */
export function useRetainedCanvasPaths(
  reported: readonly SourcePath[],
  {
    selected,
    resetKey,
  }: {
    selected: SourcePath | null;
    resetKey: string;
  },
): RetainedCanvasPaths {
  const val = useValSystem();
  /*
   * Re-checked on every edit, which is when a kept path can stop existing: an
   * item removed in the editor is gone from the content before the page has
   * re-rendered and reported anything.
   */
  const chainVersion = useChainVersion();
  const memory = useRef<Memory>({ resetKey, listed: [], workedOn: new Set() });

  const paths = useMemo(() => {
    void chainVersion;
    if (memory.current.resetKey !== resetKey) {
      memory.current = { resetKey, listed: [], workedOn: new Set() };
    }
    const current = memory.current;
    if (
      selected !== null &&
      (current.listed.includes(selected) || reported.includes(selected))
    ) {
      current.workedOn.add(selected);
    }
    const listed = mergeRetainedPaths(
      current.listed,
      reported,
      (path) =>
        current.workedOn.has(path) &&
        (val === null || val.system.sourceStore.peek(path).status !== "absent"),
    );
    current.listed = listed;
    return listed;
  }, [val, chainVersion, reported, selected, resetKey]);

  const offPage = useMemo(() => {
    if (paths.length === reported.length) return NONE;
    const shown = new Set(reported);
    return new Set(paths.filter((path) => !shown.has(path)));
  }, [paths, reported]);

  return { paths, offPage };
}
