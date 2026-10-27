import { Eye } from "lucide-react";
import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import { cn } from "../components/designSystem/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/designSystem/tooltip";
import { useContentViews } from "./ContentAnalytics";
import { compactNumber, viewsText, wholeNumber } from "./moduleAnalytics";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * In how many page views the content at `path` was on screen, beside it in
 * the form or the list: an eye and a number, and in its tooltip out of how
 * many page views it was on the page in. Nothing when there is nothing to
 * say -- see `ContentAnalyticsProvider`.
 */
export function ContentViewsBadge({
  path,
  className,
}: {
  path: SourcePath | ModuleFilePath;
  className?: string;
}) {
  const found = useContentViews(path);
  if (found === null || found.views.rendered === 0) return null;
  const { views } = found;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="content-views"
          className={cn(
            "shrink-0 inline-flex items-center gap-1 rounded px-1 h-5",
            "text-[11px] leading-none tabular-nums text-fg-tertiary",
            className,
          )}
          aria-label={`Seen in ${wholeNumber(views.viewed)} page views`}
        >
          <Eye size={12} aria-hidden="true" />
          {compactNumber(views.viewed)}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="end"
        className="max-w-[260px] text-xs"
      >
        {viewsText(views, found, today())}
      </TooltipContent>
    </Tooltip>
  );
}
