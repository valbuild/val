import {
  ChevronLeft,
  CodeXml,
  Database,
  FileText,
  ImageIcon,
  Monitor,
  MousePointerSquareDashed,
  PenLine,
  RotateCw,
  Send,
  Settings,
  Smartphone,
  Sparkles,
  Tablet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "../../../designSystem/cn";
import {
  GAP,
  GUTTER,
  RAIL_WIDTH,
  workspaceLayout,
  type NarrowStrategy,
  type SidePane,
  type WorkspaceColumn,
  type WorkspaceLayout,
  type WorkspacePane,
} from "../workspaceLayout";

/**
 * A mock Studio, laid out by `workspaceLayout`: the prototype the stories and
 * the comparison page are made of. Nothing here is wired to Val; the panes
 * are stand-ins with enough in them to judge the widths by.
 */

export type MockState = {
  open: Record<SidePane, boolean>;
  recent: SidePane[];
  front: "sketch" | "chat";
  narrow: NarrowStrategy;
  phonePane: WorkspacePane;
  codeMode: boolean;
  selecting: boolean;
  /** The field open in Content, by the preview's names for them. */
  focused: string | null;
  /** In code mode: what the next chat message is about. */
  pointedAt: string | null;
  /** For a still picture of a hover: the element the pointer is over. */
  hovered?: string | null;
};

export const DEFAULT_MOCK_STATE: MockState = {
  open: { content: true, sketch: true, chat: true },
  recent: ["content", "chat", "sketch"],
  front: "chat",
  narrow: "strips",
  phonePane: "preview",
  codeMode: false,
  selecting: true,
  focused: "title",
  pointedAt: null,
};

export function useMockState(initial: Partial<MockState> = {}) {
  const [state, setState] = useState<MockState>({
    ...DEFAULT_MOCK_STATE,
    ...initial,
  });
  const update = useCallback(
    (change: Partial<MockState>) =>
      setState((current) => ({ ...current, ...change })),
    [],
  );
  /** A pane was used: it goes to the front of `recent`, and of its tabs. */
  const use = useCallback(
    (pane: WorkspacePane) =>
      setState((current) => {
        if (pane === "preview") return { ...current, phonePane: "preview" };
        return {
          ...current,
          phonePane: pane,
          open: { ...current.open, [pane]: true },
          recent: [pane, ...current.recent.filter((each) => each !== pane)],
          front: pane === "content" ? current.front : pane,
        };
      }),
    [],
  );
  const toggle = useCallback(
    (pane: SidePane) =>
      setState((current) => {
        const opening = !current.open[pane];
        return {
          ...current,
          open: { ...current.open, [pane]: opening },
          recent: opening
            ? [pane, ...current.recent.filter((each) => each !== pane)]
            : current.recent,
          front: opening && pane !== "content" ? pane : current.front,
        };
      }),
    [],
  );
  return { state, update, use, toggle };
}

type Controls = ReturnType<typeof useMockState>;

/** The Studio at `width` × `height`, at 1:1. */
export function WorkspaceMock({
  width,
  height,
  controls,
}: {
  width: number;
  height: number;
  controls: Controls;
}) {
  const { state } = controls;
  const layout = workspaceLayout({ width, ...state });
  return (
    <div
      className="relative overflow-hidden bg-bg-canvas font-sans text-fg-primary"
      style={{ width, height }}
    >
      {layout.kind === "phone" ? (
        <PhoneMock layout={layout} controls={controls} />
      ) : (
        <ColumnsMock layout={layout} controls={controls} />
      )}
    </div>
  );
}

const TOP = 60;

function ColumnsMock({
  layout,
  controls,
}: {
  layout: Extract<WorkspaceLayout, { kind: "columns" }>;
  controls: Controls;
}) {
  const left = layout.rail ? RAIL_WIDTH : GUTTER;
  return (
    <>
      <TopBarMock controls={controls} compact={false} />
      {layout.rail && <RailMock />}
      <div
        className="absolute flex"
        style={{ top: TOP, bottom: GUTTER, left, right: GUTTER, gap: GAP }}
      >
        {layout.columns.map((column, index) => (
          <ColumnMock key={index} column={column} controls={controls} />
        ))}
        {layout.overlay !== null && (
          <div
            className="absolute bottom-0 top-0 z-window flex shadow-2xl"
            style={{
              width: layout.overlay.width,
              ...(layout.overlay.edge === "left"
                ? {
                    left:
                      layout.columns[0]?.type === "strip"
                        ? layout.columns[0].width + GAP
                        : 0,
                  }
                : { right: 0 }),
            }}
          >
            <ColumnMock
              column={layout.overlay.column}
              controls={controls}
              // Closing a sheet hands the room back to the pane beside it.
              onClose={() =>
                controls.use(
                  layout.overlay?.edge === "left"
                    ? controls.state.front
                    : "content",
                )
              }
            />
          </div>
        )}
      </div>
    </>
  );
}

function ColumnMock({
  column,
  controls,
  onClose,
}: {
  column: WorkspaceColumn;
  controls: Controls;
  onClose?: () => void;
}) {
  if (column.type === "strip") {
    return <StripMock column={column} controls={controls} />;
  }
  const style: CSSProperties = { width: column.width, flex: "none" };
  if (column.type === "tabs") {
    return (
      <Card style={style} onPointerDown={() => controls.use(column.front)}>
        <PaneTabs
          tabs={column.panes.map((pane) => ({
            value: pane,
            label: PANES[pane].label,
            icon: PANES[pane].icon,
          }))}
          value={column.front}
          onChange={(pane) => controls.use(pane)}
          onClose={onClose}
        />
        <PaneBody pane={column.front} controls={controls} />
      </Card>
    );
  }
  if (column.pane === "preview") {
    return (
      <Card
        style={style}
        className={cn(controls.state.codeMode && "border-border-proposal")}
      >
        <PreviewMock controls={controls} width={column.width} />
      </Card>
    );
  }
  const pane = column.pane;
  return (
    <Card style={style} onPointerDown={() => controls.use(pane)}>
      <PaneHeader
        icon={PANES[pane].icon}
        label={PANES[pane].label}
        onClose={onClose}
      />
      <PaneBody pane={pane} controls={controls} />
    </Card>
  );
}

const PANES: Record<SidePane, { label: string; icon: LucideIcon }> = {
  content: { label: "Content", icon: FileText },
  sketch: { label: "Sketch", icon: PenLine },
  chat: { label: "Assistant", icon: Sparkles },
};

function Card({
  children,
  style,
  className,
  onPointerDown,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  onPointerDown?: () => void;
}) {
  return (
    <section
      style={style}
      onPointerDown={onPointerDown}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-float bg-bg-float shadow-sm",
        className,
      )}
    >
      {children}
    </section>
  );
}

function PaneHeader({
  icon: Icon,
  label,
  onClose,
}: {
  icon: LucideIcon;
  label: string;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-float px-3 text-xs font-medium">
      <Icon size={14} className="text-fg-secondary" />
      {label}
      <div className="flex-1" />
      {onClose && <CloseButton onClick={onClose} />}
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="grid h-6 w-6 place-items-center rounded text-fg-secondary hover:bg-bg-float-raised"
    >
      <X size={14} />
    </button>
  );
}

function PaneTabs<T extends string>({
  tabs,
  value,
  onChange,
  onClose,
}: {
  tabs: { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (value: T) => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-float px-2">
      <div
        role="tablist"
        className="inline-flex h-7 items-center rounded-md border border-border-float p-0.5"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={tab.value === value}
              onClick={() => onChange(tab.value)}
              className={cn(
                "inline-flex h-full items-center gap-1.5 rounded px-2 text-xs font-medium",
                tab.value === value
                  ? "bg-bg-float-raised text-fg-primary"
                  : "text-fg-secondary hover:text-fg-primary",
              )}
            >
              {Icon && <Icon size={13} />}
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1" />
      {onClose && <CloseButton onClick={onClose} />}
    </div>
  );
}

function PaneBody({ pane, controls }: { pane: SidePane; controls: Controls }) {
  if (pane === "content") return <ContentMock controls={controls} />;
  if (pane === "sketch") return <SketchMock controls={controls} />;
  return <ChatMock controls={controls} />;
}

function StripMock({
  column,
  controls,
}: {
  column: Extract<WorkspaceColumn, { type: "strip" }>;
  controls: Controls;
}) {
  return (
    <div
      className="flex flex-none flex-col items-center gap-1 rounded-lg border border-border-float bg-bg-float py-2"
      style={{ width: column.width }}
    >
      {column.panes.map((pane) => {
        const Icon = PANES[pane].icon;
        return (
          <button
            key={pane}
            type="button"
            title={`Show ${PANES[pane].label}`}
            onClick={() => controls.use(pane)}
            className="flex w-8 flex-col items-center gap-2 rounded-md py-2 text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
          >
            <Icon size={16} />
            <span className="text-[11px] font-medium [writing-mode:vertical-rl]">
              {PANES[pane].label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TopBarMock({
  controls,
  compact,
}: {
  controls: Controls;
  compact: boolean;
}) {
  const { state, update, toggle } = controls;
  return (
    <div
      className="absolute left-3 right-3 top-3 flex h-10 items-center gap-2"
      style={compact ? undefined : { left: GUTTER }}
    >
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-fg-primary text-xs font-bold text-bg-primary">
        V
      </div>
      <div className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-border-proposal bg-bg-proposal-soft px-2 text-xs font-medium text-fg-proposal">
        <span className="h-2 w-2 shrink-0 rounded-full bg-bg-proposal" />
        <span className="truncate">Spring campaign</span>
      </div>
      <button
        type="button"
        aria-pressed={state.codeMode}
        title={state.codeMode ? "Code mode is on" : "Turn on code mode"}
        onClick={() => update({ codeMode: !state.codeMode })}
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-md border",
          state.codeMode
            ? "border-border-proposal bg-bg-proposal text-fg-on-proposal"
            : "border-border-float bg-bg-float text-fg-secondary",
        )}
      >
        <CodeXml size={15} />
      </button>
      <div className="flex-1" />
      {!compact && (
        <div className="flex items-center gap-1 rounded-md border border-border-float bg-bg-float p-0.5">
          {(Object.keys(PANES) as SidePane[]).map((pane) => {
            const Icon = PANES[pane].icon;
            return (
              <button
                key={pane}
                type="button"
                aria-pressed={state.open[pane]}
                title={`${state.open[pane] ? "Close" : "Open"} ${PANES[pane].label}`}
                onClick={() => toggle(pane)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium",
                  state.open[pane]
                    ? "bg-bg-float-raised text-fg-primary"
                    : "text-fg-secondary hover:text-fg-primary",
                )}
              >
                <Icon size={13} />
                {PANES[pane].label}
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        className="h-8 shrink-0 rounded-md bg-bg-proposal px-3 text-xs font-medium text-fg-on-proposal"
      >
        Save
      </button>
    </div>
  );
}

function RailMock() {
  const items: { icon: LucideIcon; label: string }[] = [
    { icon: FileText, label: "Pages" },
    { icon: Database, label: "Data" },
    { icon: ImageIcon, label: "Media" },
    { icon: Settings, label: "Settings" },
  ];
  return (
    <nav
      className="absolute flex flex-col items-center gap-1 rounded-lg border border-border-float bg-bg-float py-2"
      style={{ top: TOP, left: GUTTER, bottom: GUTTER, width: 64 }}
    >
      {items.map(({ icon: Icon, label }) => (
        <div
          key={label}
          className="flex w-14 flex-col items-center gap-1 rounded-md py-2 text-[10px] text-fg-secondary"
        >
          <Icon size={16} />
          {label}
        </div>
      ))}
    </nav>
  );
}

/* The panes. */

const FIELDS: { id: string; label: string; value: string }[] = [
  { id: "title", label: "Title", value: "Spring has come to Oslo" },
  {
    id: "lead",
    label: "Lead",
    value:
      "Six new dishes, one long table, and the first evening on the terrace.",
  },
  { id: "hero", label: "Hero image", value: "terrace.webp · 2400 × 1350" },
  { id: "cards", label: "Highlights", value: "3 items" },
];

function ContentMock({ controls }: { controls: Controls }) {
  const { state, update } = controls;
  const [tab, setTab] = useState<"structure" | "page">("page");
  return (
    <>
      <PaneTabs
        tabs={[
          { value: "structure", label: "Structure" },
          { value: "page", label: "On this page" },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-3 flex items-center gap-1 text-xs text-fg-secondary">
          <ChevronLeft size={13} />
          Blog
        </div>
        <h2 className="mb-4 text-base font-medium">Spring menu</h2>
        {tab === "structure" ? (
          <ul className="flex flex-col gap-1 text-sm">
            {["Title", "Lead", "Hero image", "Sections", "Author", "SEO"].map(
              (label) => (
                <li
                  key={label}
                  className="rounded-md border border-border-float px-3 py-2"
                >
                  {label}
                </li>
              ),
            )}
          </ul>
        ) : (
          <div className="flex flex-col gap-4">
            {FIELDS.map((field) => (
              <label
                key={field.id}
                className="flex flex-col gap-1.5"
                onClick={() => update({ focused: field.id })}
              >
                <span className="text-xs font-medium text-fg-secondary">
                  {field.label}
                </span>
                <span
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm",
                    state.focused === field.id
                      ? "border-border-brand-secondary"
                      : "border-border-float",
                  )}
                >
                  {field.value}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

const SKETCH_BOXES = [
  "Hero: a bigger image, a shorter headline",
  "Add a quote from the chef under the lead",
  "Highlights: three cards, not four",
  "Footer: sign up for the newsletter",
];

function SketchMock({ controls }: { controls: Controls }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div>
        <h3 className="text-sm font-medium">Front page for spring</h3>
        <p className="text-xs text-fg-secondary">About /blog/spring · Saved</p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
        {SKETCH_BOXES.map((box) => (
          <div
            key={box}
            className="min-h-20 rounded-md border border-dashed border-border-float bg-bg-canvas p-3 text-xs"
          >
            {box}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => controls.use("chat")}
        className="inline-flex h-8 items-center gap-1.5 self-start rounded-md border border-border-float px-3 text-xs font-medium hover:bg-bg-float-raised"
      >
        <Sparkles size={13} />
        Ask the assistant
      </button>
    </div>
  );
}

function ChatMock({ controls }: { controls: Controls }) {
  const { state, update } = controls;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 text-sm">
        <div className="self-end rounded-lg bg-bg-float-raised px-3 py-2">
          Make the hero image full width on phones
        </div>
        <div className="text-fg-secondary">
          Changed <code className="text-xs">HeroSection.tsx</code>: under 640px
          the image spans the page. The preview updates when the build is done.
        </div>
      </div>
      <div className="m-3 flex flex-col gap-2 rounded-lg border border-border-float p-2">
        {state.pointedAt !== null && (
          <span className="inline-flex items-center gap-1 self-start rounded border border-dashed border-border-proposal px-1.5 py-0.5 text-[11px] text-fg-proposal">
            <MousePointerSquareDashed size={12} />
            {state.pointedAt}
            <button
              type="button"
              aria-label="Remove"
              onClick={() => update({ pointedAt: null })}
            >
              <X size={11} />
            </button>
          </span>
        )}
        <div className="flex items-center gap-2 text-xs text-fg-secondary-alt">
          <span className="flex-1">Ask for a change…</span>
          <Send size={14} />
        </div>
      </div>
    </div>
  );
}

type DeviceId = "desktop" | "tablet" | "mobile";

const DEVICES: { id: DeviceId; icon: LucideIcon }[] = [
  { id: "desktop", icon: Monitor },
  { id: "tablet", icon: Tablet },
  { id: "mobile", icon: Smartphone },
];

function PreviewMock({
  controls,
  width,
}: {
  controls: Controls;
  width: number;
}) {
  const { state, update } = controls;
  const [device, setDevice] = useState<DeviceId>("desktop");
  const narrow = width < 640;
  const pick = (field: string | null, element: string) => {
    if (!state.selecting) return;
    if (!state.codeMode && field === null) return;
    update({
      ...(field !== null ? { focused: field } : {}),
      ...(state.codeMode ? { pointedAt: element } : {}),
    });
    if (field !== null) controls.use("content");
  };
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border-float px-2">
        <span className="min-w-0 flex-1 truncate rounded-md border border-border-float px-2 py-1 font-mono text-xs text-fg-secondary">
          /blog/spring
        </span>
        {!narrow &&
          DEVICES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-label={id}
              aria-pressed={device === id}
              onClick={() => setDevice(id)}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-md",
                device === id
                  ? "bg-bg-float-raised text-fg-primary"
                  : "text-fg-secondary",
              )}
            >
              <Icon size={14} />
            </button>
          ))}
        <button
          type="button"
          aria-pressed={state.selecting}
          title={
            state.codeMode
              ? "Select any element: its field opens, and it goes with your next message"
              : "Select a field on the page"
          }
          onClick={() => update({ selecting: !state.selecting })}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium",
            state.selecting
              ? "bg-bg-float-raised text-fg-primary"
              : "text-fg-secondary",
          )}
        >
          <MousePointerSquareDashed size={14} />
          {!narrow && "Select"}
          {state.codeMode && (
            <CodeXml
              size={11}
              className="text-fg-proposal"
              aria-label="code mode"
            />
          )}
        </button>
        <span
          className="inline-flex h-7 items-center gap-1 px-1 text-xs text-fg-secondary"
          title="Reload"
        >
          <RotateCw size={13} />
          {state.codeMode && !narrow && "Up to date"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-bg-canvas p-3">
        <SitePage
          maxWidth={
            device === "mobile" ? 390 : device === "tablet" ? 834 : undefined
          }
          selecting={state.selecting}
          codeMode={state.codeMode}
          focused={state.focused}
          hovered={state.hovered ?? null}
          onPick={pick}
        />
      </div>
    </>
  );
}

/** The site in the preview: a restaurant's spring menu. */
function SitePage({
  maxWidth,
  selecting,
  codeMode,
  focused,
  hovered,
  onPick,
}: {
  maxWidth?: number;
  selecting: boolean;
  codeMode: boolean;
  focused: string | null;
  hovered: string | null;
  onPick: (field: string | null, element: string) => void;
}) {
  const el = (field: string | null, element: string) => ({
    onClick: () => onPick(field, element),
    className: cn(
      "rounded-sm",
      selecting &&
        field !== null &&
        "cursor-pointer outline outline-1 outline-offset-2 outline-[color-mix(in_srgb,var(--border-brand-secondary)_45%,transparent)]",
      selecting &&
        field !== null &&
        focused === field &&
        "outline-2 outline-border-brand-secondary",
      selecting &&
        codeMode &&
        "cursor-pointer hover:outline-dashed hover:outline-2 hover:-outline-offset-2 hover:outline-border-proposal",
      selecting &&
        codeMode &&
        hovered === element &&
        "outline-dashed outline-2 -outline-offset-2 outline-border-proposal",
    ),
  });
  return (
    <div
      className="mx-auto overflow-hidden rounded-md bg-white text-[#1d2420] shadow-sm"
      style={{ maxWidth }}
    >
      <header className="flex items-center justify-between border-b border-[#e6e3dc] px-5 py-3">
        <span {...el(null, "header › logo")}>
          <span className="font-serif text-sm font-bold">Nordlys Kjøkken</span>
        </span>
        <span className="text-xs text-[#5b6660]">Menu · Book · Visit</span>
      </header>
      <div className="flex flex-col gap-4 px-5 py-6">
        <h1 {...el("title", "h1 · “Spring has come to Oslo”")}>
          <span className="block font-serif text-2xl font-bold leading-tight">
            Spring has come to Oslo
          </span>
        </h1>
        <p {...el("lead", "p.lead · “Six new dishes…”")}>
          <span className="text-sm text-[#4a5550]">
            Six new dishes, one long table, and the first evening on the
            terrace.
          </span>
        </p>
        <div {...el("hero", "img.hero · terrace.webp")}>
          <div className="aspect-[16/7] max-h-44 w-full rounded bg-gradient-to-br from-[#c9d8c5] to-[#8fae9a]" />
        </div>
        <div
          {...el("cards", "section.highlights")}
          // The grid wraps, so a narrow preview stacks the cards.
        >
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
            {["Nettles & egg", "Spring lamb", "Rhubarb tart"].map((dish) => (
              <div
                key={dish}
                className="rounded border border-[#e6e3dc] p-3 text-xs"
              >
                <div className="mb-2 h-10 rounded bg-[#eef1ea]" />
                {dish}
              </div>
            ))}
          </div>
        </div>
      </div>
      <footer
        {...el(null, "footer")}
        // Nothing in the footer is content: only code mode can pick it.
      >
        <div className="border-t border-[#e6e3dc] px-5 py-3 text-xs text-[#5b6660]">
          Grünerløkka, Oslo · Open Tue–Sun
        </div>
      </footer>
    </div>
  );
}

/* A phone: one pane at a time, the bottom bar to switch. */

function PhoneMock({
  layout,
  controls,
}: {
  layout: Extract<WorkspaceLayout, { kind: "phone" }>;
  controls: Controls;
}) {
  const icons: Record<WorkspacePane, { label: string; icon: LucideIcon }> = {
    ...PANES,
    preview: { label: "Preview", icon: Monitor },
  };
  return (
    <>
      <TopBarMock controls={controls} compact />
      <div className="absolute inset-x-3 bottom-[68px] top-[60px] flex">
        {layout.pane === "preview" ? (
          <Card
            className={cn(
              "flex-1",
              controls.state.codeMode && "border-border-proposal",
            )}
          >
            <PreviewMock controls={controls} width={360} />
          </Card>
        ) : (
          <Card className="flex-1">
            <PaneBody pane={layout.pane} controls={controls} />
          </Card>
        )}
      </div>
      <nav className="absolute inset-x-3 bottom-3 flex h-[52px] items-center justify-around rounded-lg border border-border-float bg-bg-float">
        {layout.tabs.map((pane) => {
          const { label, icon: Icon } = icons[pane];
          return (
            <button
              key={pane}
              type="button"
              aria-pressed={layout.pane === pane}
              onClick={() => controls.use(pane)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-md px-3 py-1 text-[10px]",
                layout.pane === pane ? "text-fg-primary" : "text-fg-secondary",
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          );
        })}
      </nav>
    </>
  );
}

/** A one-line description of the layout, for the stories' captions. */
export function describeLayout(layout: WorkspaceLayout): string {
  if (layout.kind === "phone") return `phone · ${layout.pane}`;
  const name = (column: WorkspaceColumn): string =>
    column.type === "pane"
      ? column.pane === "chat"
        ? "assistant"
        : column.pane
      : column.type === "tabs"
        ? `${column.panes.join(" ↔ ").replace("chat", "assistant")}`
        : `${column.panes.join("/").replace("chat", "assistant")} folded`;
  const columns = layout.columns.map(name).join(" | ");
  const overlay =
    layout.overlay === null
      ? ""
      : ` · ${name(layout.overlay.column)} over the preview`;
  return `${layout.breakpoint} · ${columns}${overlay}`;
}
