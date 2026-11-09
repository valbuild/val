import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../../designSystem/cn";
import { workspaceLayout, type WorkspacePane } from "../workspaceLayout";
import {
  WorkspaceMock,
  describeLayout,
  useMockState,
  type MockState,
} from "./WorkspaceMock";

/** Window sizes people have, to jump to. */
export const PRESETS: { label: string; width: number; height: number }[] = [
  { label: "Phone", width: 390, height: 844 },
  { label: "iPad", width: 1024, height: 768 },
  { label: "Laptop", width: 1366, height: 768 },
  { label: "MacBook", width: 1512, height: 945 },
  { label: "Desktop", width: 1920, height: 1080 },
  { label: "Ultrawide", width: 2560, height: 1440 },
];

const MIN_WIDTH = 360;

const OPEN_CHIPS: { pane: WorkspacePane; label: string }[] = [
  { pane: "content", label: "Content" },
  { pane: "preview", label: "Preview" },
  { pane: "sketch", label: "Sketch" },
  { pane: "chat", label: "Assistant" },
];
const MAX_WIDTH = 2800;

/**
 * The mock Studio at any window width: drag the handle, or pick a preset. The
 * window is drawn to scale when it is wider than the space it is shown in,
 * so a 2560px layout can be judged on a laptop.
 */
export function ResizableWorkspace({
  initialWidth = 1366,
  initialHeight = 768,
  initial,
}: {
  initialWidth?: number;
  initialHeight?: number;
  initial?: Partial<MockState>;
}) {
  const controls = useMockState(initial);
  const { state, update, toggle } = controls;
  const [size, setSize] = useState({
    width: initialWidth,
    height: initialHeight,
  });
  const stage = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(1200);
  useLayoutEffect(() => {
    const element = stage.current;
    if (element === null) return;
    const measure = () => setRoom(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The handle sits outside the window, so it needs its own room.
  const scale = Math.min(1, (room - 24) / size.width);
  const layout = workspaceLayout({ width: size.width, ...state });

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = size.width;
    const move = (moveEvent: PointerEvent) => {
      const width = Math.round(
        Math.min(
          MAX_WIDTH,
          Math.max(
            MIN_WIDTH,
            startWidth + (moveEvent.clientX - startX) / scale,
          ),
        ),
      );
      setSize((current) => ({ ...current, width }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex flex-col gap-3 font-sans text-fg-primary">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <Group label="Window">
          {PRESETS.map((preset) => (
            <Chip
              key={preset.label}
              active={size.width === preset.width}
              onClick={() =>
                setSize({ width: preset.width, height: preset.height })
              }
            >
              {preset.label}
              <span className="ml-1 tabular-nums text-fg-secondary-alt">
                {preset.width}
              </span>
            </Chip>
          ))}
          <input
            id="workspace-width"
            aria-label="Window width"
            type="range"
            min={MIN_WIDTH}
            max={MAX_WIDTH}
            value={size.width}
            onChange={(event) =>
              setSize((current) => ({
                ...current,
                width: Number(event.target.value),
              }))
            }
            className="w-40 accent-current"
          />
        </Group>
        <Group label="Open">
          {OPEN_CHIPS.map(({ pane, label }) => (
            <Chip
              key={pane}
              active={state.open[pane]}
              onClick={() => toggle(pane)}
            >
              {label}
            </Chip>
          ))}
        </Group>
        <Group label="Used last">
          <Chip
            active={state.recent[0] === "content"}
            onClick={() => controls.use("content")}
          >
            Content
          </Chip>
          <Chip
            active={state.recent[0] !== "content"}
            onClick={() => controls.use(state.front)}
          >
            Sketch / Assistant
          </Chip>
        </Group>
        <Group label="When only one fits">
          <Chip
            active={state.narrow === "strips"}
            onClick={() => update({ narrow: "strips" })}
          >
            (a) Fold to a strip
          </Chip>
          <Chip
            active={state.narrow === "overlay"}
            onClick={() => update({ narrow: "overlay" })}
          >
            (b) Content over the preview
          </Chip>
        </Group>
        <Group label="Mode">
          <Chip
            active={state.codeMode}
            onClick={() =>
              update({ codeMode: !state.codeMode, pointedAt: null })
            }
          >
            Code mode
          </Chip>
        </Group>
      </div>
      <p className="text-xs text-fg-secondary">
        <span className="font-medium tabular-nums text-fg-primary">
          {size.width} × {size.height}
        </span>{" "}
        · {describeLayout(layout)}
        {scale < 1 && (
          <span className="text-fg-secondary-alt">
            {" "}
            · drawn at {Math.round(scale * 100)}%
          </span>
        )}
      </p>
      <div ref={stage} className="w-full">
        <div
          className="relative"
          style={{
            width: size.width * scale + 16,
            height: size.height * scale,
          }}
        >
          <div
            className="origin-top-left overflow-hidden rounded-lg border border-border-float"
            style={{ transform: `scale(${scale})`, width: size.width }}
          >
            <WorkspaceMock
              width={size.width}
              height={size.height}
              controls={controls}
            />
          </div>
          <div
            role="separator"
            aria-label="Drag to resize the window"
            aria-orientation="vertical"
            aria-valuenow={size.width}
            onPointerDown={startDrag}
            className="absolute top-0 flex h-full w-3 cursor-ew-resize items-center justify-center"
            style={{ left: size.width * scale + 4 }}
          >
            <div className="h-12 w-1 rounded-full bg-fg-secondary-alt" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-fg-secondary">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-7 rounded-md border px-2 font-medium",
        active
          ? "border-fg-primary bg-bg-float-raised text-fg-primary"
          : "border-border-float text-fg-secondary hover:text-fg-primary",
      )}
    >
      {children}
    </button>
  );
}
