import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "../designSystem/cn";

export type SketchpadPane = "preview" | "sketchpad" | "chat";

/** What goes beside the Sketchpad when there is room for two panes only. */
export type SketchpadCompanion = "preview" | "chat";

export type SketchpadWorkspaceProps = {
  /** The site, as it is now: what the sketch is about to change. */
  preview: ReactNode;
  sketchpad: ReactNode;
  /** The AI session the Sketchpad belongs to. */
  chat: ReactNode;
  /** Beside the Sketchpad when only two panes fit. */
  defaultCompanion?: SketchpadCompanion;
  /** In front when only one pane fits. */
  defaultPane?: SketchpadPane;
};

/**
 * Widths of the workspace itself, not of the window: it sits beside the
 * Studio's rail, and what decides the layout is the room the panes get.
 *
 * Three panes need a preview wide enough to read a page in (~520px), a
 * Sketchpad wide enough for two columns of boxes (~440px) and the chat
 * (360px). Two need the Sketchpad and either of the others. Below that each
 * pane is cramped beside anything, so they take turns.
 */
const THREE_PANES = 1280;
const TWO_PANES = 820;
const CHAT_WIDTH = 360;

type Layout = "three" | "two" | "one";

function layoutFor(width: number): Layout {
  return width >= THREE_PANES ? "three" : width >= TWO_PANES ? "two" : "one";
}

/**
 * The Preview, the Sketchpad and the chat, side by side as far as the width
 * allows. The Sketchpad is the one that is always there when anything is
 * beside it; the other two are what it is compared with and who it is
 * discussed with.
 *
 * Every pane stays mounted whichever are shown, so the preview keeps its
 * page, the chat its scroll and the Sketchpad its caret and undo when the
 * layout changes under them.
 */
export function SketchpadWorkspace({
  preview,
  sketchpad,
  chat,
  defaultCompanion = "chat",
  defaultPane = "sketchpad",
}: SketchpadWorkspaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>("three");
  const [companion, setCompanion] =
    useState<SketchpadCompanion>(defaultCompanion);
  const [pane, setPane] = useState<SketchpadPane>(defaultPane);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => setLayout(layoutFor(element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const shown: Record<SketchpadPane, boolean> =
    layout === "three"
      ? { preview: true, sketchpad: true, chat: true }
      : layout === "two"
        ? {
            preview: companion === "preview",
            sketchpad: true,
            chat: companion === "chat",
          }
        : {
            preview: pane === "preview",
            sketchpad: pane === "sketchpad",
            chat: pane === "chat",
          };

  return (
    <div ref={ref} className="flex h-full min-h-0 w-full flex-col gap-2">
      {layout === "one" && (
        <PaneSwitch
          label="Show"
          options={[
            { value: "preview", label: "Preview" },
            { value: "sketchpad", label: "Sketchpad" },
            { value: "chat", label: "Chat" },
          ]}
          value={pane}
          onChange={setPane}
        />
      )}
      {layout === "two" && (
        // Above both panes, so the two start on the same line.
        <div className="flex shrink-0 justify-end">
          <PaneSwitch
            label="Beside the Sketchpad"
            options={[
              { value: "preview", label: "Preview" },
              { value: "chat", label: "Chat" },
            ]}
            value={companion}
            onChange={setCompanion}
            className="w-56"
          />
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-2">
        <Pane shown={shown.preview} className="flex-[1.2_1_0]">
          <Card>{preview}</Card>
        </Pane>
        <Pane shown={shown.sketchpad} className="flex-[1_1_0]">
          {sketchpad}
        </Pane>
        <Pane
          shown={shown.chat}
          className={layout === "one" ? "flex-1" : "shrink-0"}
          style={layout === "one" ? undefined : { width: CHAT_WIDTH }}
        >
          <Card>{chat}</Card>
        </Pane>
      </div>
    </div>
  );
}

function Pane({
  shown,
  className,
  style,
  children,
}: {
  shown: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section
      hidden={!shown}
      style={style}
      className={cn(
        "min-h-0 min-w-0 flex-col gap-2",
        shown ? "flex" : "hidden",
        className,
      )}
    >
      {children}
    </section>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border-primary bg-bg-primary">
      {children}
    </div>
  );
}

function PaneSwitch<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "flex shrink-0 rounded-lg border border-border-primary bg-bg-secondary p-0.5",
        className,
      )}
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
