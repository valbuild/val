import { useState } from "react";
import { cn } from "../components/designSystem/cn";

/**
 * The Studio, with the past beside it.
 *
 * The left side is NOT a copy of the editor — it IS the editor, passed straight
 * through. That is the point of splitting here rather than building a history
 * "view": navigation, the nav menu, validation, publishing and every field
 * behave exactly as they always do, and history is a second column that
 * appeared. A history screen that rebuilt the Studio's navigation would be a
 * second Studio to keep in step, and it would be worse at it.
 *
 * On a phone there is no room for two columns, so it becomes one pane and a
 * toggle. Which side is showing is local state rather than URL state: it is a
 * property of the screen you happen to be on, not of what you are looking at,
 * and a link that forced someone else's phone to the other tab would be wrong.
 */
export function HistorySplit({
  editor,
  history,
  commitLabel,
  breakpoint,
}: {
  editor: React.ReactNode;
  history: React.ReactNode;
  commitLabel: string;
  breakpoint: "mobile" | "tablet" | "desktop";
}) {
  const [showing, setShowing] = useState<"now" | "commit">("commit");
  if (breakpoint === "desktop") {
    return (
      <div className="flex min-w-0 flex-1 gap-4">
        <div className="min-w-0 flex-1 overflow-y-auto">{editor}</div>
        <div className="min-w-0 flex-1 overflow-y-auto border-l border-border-primary pl-4">
          {history}
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div
        className="flex gap-1 rounded-lg border border-border-primary p-1"
        role="tablist"
      >
        {(
          [
            ["now", "Now"],
            ["commit", commitLabel],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={showing === key}
            onClick={() => setShowing(key)}
            className={cn(
              "flex-1 truncate rounded px-3 py-1.5 text-sm",
              showing === key
                ? "bg-bg-brand-primary font-medium text-fg-brand-primary-alt"
                : "text-fg-tertiary",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {/*
       * Both panes stay MOUNTED, and the hidden one is hidden with `hidden`
       * rather than unmounted. Toggling would otherwise throw away scroll
       * position, open sections and any half-typed edit on the "Now" side every
       * time someone glanced at the past — which is the one thing people do
       * constantly in this view.
       */}
      <div
        className="min-w-0 flex-1 overflow-y-auto"
        hidden={showing !== "now"}
      >
        {editor}
      </div>
      <div
        className="min-w-0 flex-1 overflow-y-auto"
        hidden={showing !== "commit"}
      >
        {history}
      </div>
    </div>
  );
}
