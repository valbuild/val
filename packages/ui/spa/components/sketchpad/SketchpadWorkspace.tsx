import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../designSystem/cn";
import {
  SketchpadList,
  SketchpadStrip,
  type SketchpadListProps,
} from "./SketchpadList";

export type SketchpadPane = "preview" | "sketchpad";

export type SketchpadWorkspaceProps = {
  /** The site, as it is now: what the sketch is about to change. */
  preview: ReactNode;
  /** Null when none is open: every one in the project is archived, say. */
  sketchpad: ReactNode | null;
  /** The project's sketchpads: where one comes back from when none is open. */
  sketchpads: SketchpadListProps;
  /** Above the panes: "Archived. Undo", and the like. */
  notice?: ReactNode;
  /** In front when only one pane fits. */
  defaultPane?: SketchpadPane;
};

/**
 * Wide enough for a preview to read a page in (~400px) beside a Sketchpad
 * with room for two columns of boxes (~420px). The workspace's own width,
 * not the window's: the rail is beside it, and the assistant, docked by the
 * shell, takes its share before this is measured.
 */
const TWO_PANES = 820;

/**
 * The Preview and the Sketchpad, side by side when they fit, and one at a
 * time when not. The chat is not here: the shell docks it beside whatever is
 * on screen, so with the chat open on a wide screen this is the middle of
 * three columns -- the preview, the sketch and the conversation about it --
 * and on a narrower one the chat and the sketch, with the preview a switch
 * away.
 *
 * Both panes stay mounted whichever is shown, so the preview keeps its page
 * and the Sketchpad its caret and undo when the layout changes under them.
 */
export function SketchpadWorkspace({
  preview,
  sketchpad,
  sketchpads,
  notice,
  defaultPane = "sketchpad",
}: SketchpadWorkspaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [both, setBoth] = useState(true);
  const [pane, setPane] = useState<SketchpadPane>(defaultPane);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => setBoth(element.clientWidth >= TWO_PANES);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const closed = sketchpad === null;
  const showPreview = both || pane === "preview";
  const showSketchpad = both || pane === "sketchpad";
  // With nothing to sketch on, the Sketchpad's place is what can be
  // reopened: a strip beside the preview, or the whole list on its own.
  const strip = closed && both;

  return (
    <div ref={ref} className="flex h-full min-h-0 w-full flex-col gap-2">
      {notice}
      {!both && (
        <PaneSwitch
          options={[
            { value: "preview", label: "Preview" },
            { value: "sketchpad", label: "Sketchpad" },
          ]}
          value={pane}
          onChange={setPane}
        />
      )}
      <div className="flex min-h-0 flex-1 gap-2">
        <section
          hidden={!showPreview}
          className={cn(
            "min-h-0 min-w-0 flex-[1_1_0] flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-primary",
            showPreview ? "flex" : "hidden",
          )}
        >
          {preview}
        </section>
        <section
          hidden={!showSketchpad}
          className={cn(
            "min-h-0 min-w-0 flex-col",
            showSketchpad ? "flex" : "hidden",
            strip ? "w-11 shrink-0" : "flex-[1_1_0]",
          )}
        >
          {!closed ? (
            sketchpad
          ) : strip ? (
            <SketchpadStrip {...sketchpads} />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border-primary bg-bg-primary">
              <div className="border-b border-border-primary px-3 py-2 text-xs font-medium text-fg-secondary">
                Sketchpads
              </div>
              <SketchpadList {...sketchpads} archivedOpen />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PaneSwitch<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Show"
      className="flex shrink-0 rounded-lg border border-border-primary bg-bg-secondary p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 flex-1 cursor-pointer rounded-md px-3 text-xs font-medium text-fg-secondary",
            value === option.value && "bg-bg-primary text-fg-primary shadow-sm",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
