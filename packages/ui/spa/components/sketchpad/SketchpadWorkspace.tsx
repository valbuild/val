import type { ReactNode } from "react";
import { SketchpadList, type SketchpadListProps } from "./SketchpadList";
import { usePaneTabs } from "../shell/workspace/PaneTabs";

export type SketchpadWorkspaceProps = {
  /** Null when none is open: every one in the project is archived, say. */
  sketchpad: ReactNode | null;
  /** The project's sketchpads: where one comes back from when none is open. */
  sketchpads: SketchpadListProps;
  /** Above the sketch: "Archived. Undo", and the like. */
  notice?: ReactNode;
};

/**
 * The Sketch pane: the open sketchpad, or -- with none open -- the list to
 * reopen one from.
 *
 * No preview of its own. The page a sketch is about is shown in the
 * Studio's one preview, the pane beside it (`ValSketchpad`'s
 * `onShowRoute`), and where it goes is the workspace's business
 * (`workspaceLayout`), as the assistant's is.
 */
export function SketchpadWorkspace({
  sketchpad,
  sketchpads,
  notice,
}: SketchpadWorkspaceProps) {
  const paneTabs = usePaneTabs();
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      {notice}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {sketchpad ?? (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border-primary bg-bg-primary">
            <div className="flex items-center gap-2 border-b border-border-primary px-3 py-2 text-xs font-medium text-fg-secondary">
              Sketchpads
              {paneTabs}
            </div>
            <SketchpadList {...sketchpads} archivedOpen />
          </div>
        )}
      </section>
    </div>
  );
}
