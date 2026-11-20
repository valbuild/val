import { useMemo } from "react";
import { Eye } from "lucide-react";
import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import { useDescriptions } from "../components/useDescriptions";
import { useNavigation } from "../components/ValRouter";
import { useContentViews, useMostSeenInside } from "./ContentAnalytics";
import { compactNumber, rangeText, wholeNumber } from "./moduleAnalytics";

const MOST_SEEN = 5;

/**
 * Under the heading of what is being edited: in how many page views it was
 * on screen, and -- for a list or an object -- what in it was seen most,
 * each named the way the Studio names it everywhere else (`describePath`:
 * the preview someone wrote, else the route, the key or the index) and each
 * leading there. Nothing when there is nothing to say.
 */
export function ContentViewsSummary({
  path,
}: {
  path: SourcePath | ModuleFilePath;
}) {
  const found = useContentViews(path);
  const inside = useMostSeenInside(path, MOST_SEEN);
  const paths = useMemo(() => inside.map((row) => row.path), [inside]);
  const { describe } = useDescriptions(paths);
  const { navigate } = useNavigation();
  if (found === null || found.views.rendered === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div
      data-testid="content-views-summary"
      className="flex flex-col gap-1 text-xs text-fg-tertiary"
    >
      <div className="flex items-center gap-1">
        <Eye size={12} aria-hidden="true" />
        <span>
          Seen in {wholeNumber(found.views.viewed)} of the{" "}
          {wholeNumber(found.views.rendered)} page views it was on,{" "}
          {rangeText(found, today)}.
        </span>
      </div>
      {inside.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>Most seen:</span>
          {inside.map((row) => (
            <button
              key={row.path}
              type="button"
              onClick={() => navigate(row.path)}
              className="inline-flex items-center gap-1 rounded px-1 hover:bg-bg-secondary hover:text-fg-primary max-w-[16rem]"
              title={`Seen in ${wholeNumber(row.viewed)} page views`}
            >
              <span className="truncate">{describe(row.path).title}</span>
              <span className="tabular-nums">{compactNumber(row.viewed)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
