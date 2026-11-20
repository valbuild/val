import type { ModuleFilePath } from "@valbuild/core";
import { RotateCw, TriangleAlert } from "lucide-react";
import { OverlayCard } from "./OverlayMenu";
import { CardButton } from "./PublishHandoff";
import { codeChangedMessage } from "./canvas/CanvasCodeChangedNotice";

/**
 * This page is running older code than the Studio: what it was sent for these
 * modules was made with a schema its build does not have, so it shows its own
 * build's content for them (`codeChanged`, sent by the page's provider). A
 * reload gets the page the new code. The on-site overlay's counterpart of
 * `CanvasCodeChangedNotice`, and it says the same thing.
 */
export function CodeChangedCard({
  modules,
  onReload,
}: {
  modules: readonly ModuleFilePath[];
  onReload: () => void;
}) {
  return (
    <OverlayCard className="w-[320px] text-xs">
      <div className="flex items-start gap-2.5" role="status">
        <span className="mt-0.5 shrink-0 text-fg-warning-primary">
          <TriangleAlert size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg-primary">
            The code changed
          </p>
          <p className="mt-0.5 text-fg-secondary" title={modules.join("\n")}>
            {codeChangedMessage(modules)}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <CardButton
              onClick={onReload}
              primary
              icon={<RotateCw size={12} />}
            >
              Reload
            </CardButton>
          </div>
        </div>
      </div>
    </OverlayCard>
  );
}
