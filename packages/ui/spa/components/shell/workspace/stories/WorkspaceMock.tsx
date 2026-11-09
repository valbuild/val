import {
  ChevronLeft,
  CodeXml,
  Database,
  FileText,
  ImageIcon,
  Monitor,
  Bell,
  History,
  Languages,
  ListChecks,
  MousePointerClick,
  MousePointerSquareDashed,
  PenLine,
  RotateCw,
  Search,
  Send,
  Settings,
  Smartphone,
  Sparkles,
  ShieldCheck,
  Tablet,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "../../../designSystem/cn";
import {
  DESKTOP_FROM,
  GAP,
  GUTTER,
  PHONE_BELOW,
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
  /**
   * Which pane is picking on the page, if any. Each has its own Select:
   *
   * - `content`: Content's, at the end of its header, toward the preview.
   *   Picks FIELDS, in every mode, and opens the one picked. Stays on until
   *   turned off.
   * - `chat`: Sketch and Assistant's, at the start of their header, toward
   *   the preview. Picks what the next message to the assistant is about:
   *   fields, or in code mode any element. Once, then off, and the
   *   Assistant comes to the front with it.
   */
  selecting: SelectTool | null;
  /** Content's two views: the module's structure, or the fields on the page. */
  contentTab: "content" | "page";
  /** The field open in Content, by the preview's names for them. */
  focused: string | null;
  /** What the next chat message is about. */
  pointedAt: string | null;
  /** For a still picture of a hover: the element the pointer is over. */
  hovered?: string | null;
};

export type SelectTool = "content" | "chat";

export const DEFAULT_MOCK_STATE: MockState = {
  open: { content: true, sketch: true, chat: true },
  recent: ["content", "chat", "sketch"],
  front: "chat",
  narrow: "strips",
  phonePane: "preview",
  codeMode: false,
  selecting: "content",
  contentTab: "page",
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
  const { state, update } = controls;
  const layout = workspaceLayout({ width, ...state });
  useEffect(() => {
    if (state.selecting === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") update({ selecting: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.selecting, update]);
  return (
    <div
      className="relative overflow-hidden bg-bg-canvas font-sans text-fg-primary"
      style={{ width, height }}
    >
      {layout.kind === "phone" ? (
        <PhoneMock layout={layout} controls={controls} />
      ) : (
        <ColumnsMock layout={layout} controls={controls} width={width} />
      )}
    </div>
  );
}

const TOP = 60;

function ColumnsMock({
  layout,
  controls,
  width,
}: {
  layout: Extract<WorkspaceLayout, { kind: "columns" }>;
  controls: Controls;
  width: number;
}) {
  const left = layout.rail ? RAIL_WIDTH : GUTTER;
  return (
    <>
      <TopBarMock controls={controls} width={width} />
      {layout.rail && <RailMock />}
      <div
        className="absolute flex"
        style={{ top: TOP, bottom: GUTTER, left, right: GUTTER, gap: GAP }}
      >
        {layout.columns.map((column, index) => (
          <ColumnMock
            key={index}
            column={column}
            controls={controls}
            sideSelect={index === firstSideColumn(layout.columns)}
          />
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
              sideSelect
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

/**
 * The first column after the preview that holds Sketch or Assistant: the one
 * whose header carries their Select, beside the preview.
 */
function firstSideColumn(columns: WorkspaceColumn[]): number {
  return columns.findIndex(
    (column) =>
      column.type === "tabs" ||
      (column.type === "pane" &&
        (column.pane === "sketch" || column.pane === "chat")),
  );
}

function ColumnMock({
  column,
  controls,
  onClose,
  sideSelect = false,
}: {
  column: WorkspaceColumn;
  controls: Controls;
  onClose?: () => void;
  /** Whether this column's header carries Sketch and Assistant's Select. */
  sideSelect?: boolean;
}) {
  if (column.type === "strip") {
    return <StripMock column={column} controls={controls} />;
  }
  const style: CSSProperties = { width: column.width, flex: "none" };
  if (column.type === "pane" && column.pane === "preview") {
    return (
      <Card
        style={style}
        className={cn(controls.state.codeMode && "border-border-proposal")}
      >
        <PreviewMock controls={controls} width={column.width} />
      </Card>
    );
  }
  if (column.type === "pane" && column.pane === "content") {
    return (
      <Card style={style} onPointerDown={() => controls.use("content")}>
        <ContentHeader
          controls={controls}
          width={column.width}
          onClose={onClose}
        />
        <ContentMock controls={controls} />
      </Card>
    );
  }
  const panes: ("sketch" | "chat")[] =
    column.type === "tabs"
      ? column.panes
      : column.pane === "sketch"
        ? ["sketch"]
        : ["chat"];
  const front = column.type === "tabs" ? column.front : panes[0];
  return (
    <Card style={style} onPointerDown={() => controls.use(front)}>
      <SideHeader
        controls={controls}
        panes={panes}
        front={front}
        width={column.width}
        select={sideSelect}
        onClose={onClose}
      />
      <PaneBody pane={front} controls={controls} />
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

function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex h-7 shrink-0 items-center rounded-md border border-border-float p-0.5"
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
  );
}

/** Below this a header's Select drops its label and keeps its icon. */
const SELECT_LABEL_FROM = 320;

/**
 * Content's header: its views on the left, its Select on the right, the
 * side the preview is on. Close, where there is one, on the outer edge.
 */
function ContentHeader({
  controls,
  width,
  onClose,
}: {
  controls: Controls;
  width: number;
  onClose?: () => void;
}) {
  const { state, update } = controls;
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-float px-2">
      {onClose && <CloseButton onClick={onClose} />}
      <Tabs
        tabs={[
          { value: "content", label: "Content" },
          { value: "page", label: "On this page" },
        ]}
        value={state.contentTab}
        onChange={(contentTab) => update({ contentTab })}
      />
      <div className="flex-1" />
      <SelectButton
        tool="content"
        controls={controls}
        label={width >= SELECT_LABEL_FROM}
        title="Select a field on the page to edit it"
      />
    </div>
  );
}

/**
 * Sketch and Assistant's header, the mirror of Content's: the Select on the
 * left, toward the preview, and the tabs on the right. A column holding one
 * of them shows its one tab, so the header reads the same either way.
 */
function SideHeader({
  controls,
  panes,
  front,
  width,
  select,
  onClose,
}: {
  controls: Controls;
  panes: ("sketch" | "chat")[];
  front: "sketch" | "chat";
  width: number;
  select: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-float px-2">
      {select && (
        <SelectButton
          tool="chat"
          controls={controls}
          label={width >= SELECT_LABEL_FROM}
          title={
            controls.state.codeMode
              ? "Select anything on the page, to ask the assistant about it"
              : "Select a field on the page, to ask the assistant about it"
          }
        />
      )}
      <div className="flex-1" />
      <Tabs
        tabs={panes.map((pane) => ({
          value: pane,
          label: PANES[pane].label,
          icon: PANES[pane].icon,
        }))}
        value={front}
        onChange={(pane) => controls.use(pane)}
      />
      {onClose && <CloseButton onClick={onClose} />}
    </div>
  );
}

/**
 * A pane's own Select: it picks on the preview, for that pane. The two look
 * the same at rest; while picking, Content's is solid and the Assistant's
 * dashed, in the proposal's colour in code mode, as their outlines are.
 */
function SelectButton({
  tool,
  controls,
  label,
  title,
}: {
  tool: SelectTool;
  controls: Controls;
  /** Whether there is room for the word beside the icon. */
  label: boolean;
  title: string;
}) {
  const { state, update } = controls;
  const active = state.selecting === tool;
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label ? undefined : "Select"}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        // On a phone the page is another pane: go to it to pick.
        update(
          active
            ? { selecting: null }
            : { selecting: tool, phonePane: "preview" },
        );
      }}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium",
        active
          ? tool === "content"
            ? "border-border-brand-secondary bg-bg-float-raised text-fg-primary"
            : state.codeMode
              ? "border-dashed border-border-proposal bg-bg-proposal-soft text-fg-proposal"
              : "border-dashed border-border-brand-secondary bg-bg-float-raised text-fg-primary"
          : "border-border-float text-fg-secondary hover:text-fg-primary",
      )}
    >
      <MousePointerSquareDashed size={14} />
      {label && "Select"}
      {tool === "chat" && state.codeMode && (
        <CodeXml size={11} aria-label="code mode" />
      )}
    </button>
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

/**
 * Today's top bar, with one change: Content, Sketch and Assistant take the
 * place of the Preview button, which has nothing to toggle once the preview
 * is the anchor. Everything else is where it is now -- search, members, the
 * locale, Review, Save or Publish, errors, history, notifications and the
 * account -- and only shown, not wired.
 */
function TopBarMock({
  controls,
  width,
}: {
  controls: Controls;
  width: number;
}) {
  const { state, update, toggle } = controls;
  const phone = width < PHONE_BELOW;
  const roomy = width >= 1500;
  const desktop = width >= DESKTOP_FROM;
  return (
    <div
      className="absolute top-3 flex h-10 items-center gap-2"
      style={{ left: GUTTER, right: GUTTER }}
    >
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-fg-primary text-xs font-bold text-bg-primary">
        V
      </div>
      {roomy && (
        <span className="shrink-0 text-xs font-medium text-fg-secondary">
          nordlys/site
        </span>
      )}
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
      {!phone && <Members />}
      {!phone &&
        (roomy ? (
          <div className="flex h-8 w-56 shrink items-center gap-2 rounded-md border border-border-float bg-bg-float px-2 text-xs text-fg-secondary-alt">
            <Search size={14} />
            <span className="flex-1">Search</span>
            <kbd className="font-sans text-[10px]">⌘K</kbd>
          </div>
        ) : (
          <IconStub icon={Search} label="Search" />
        ))}
      <div className="flex-1" />
      {phone ? (
        <>
          <IconStub icon={Search} label="Search" />
          <Avatar />
        </>
      ) : (
        <>
          {desktop && (
            <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border-float px-2 text-xs text-fg-secondary">
              <Languages size={14} />
              EN
            </span>
          )}
          <button
            type="button"
            title="Review 3 changes"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-float bg-bg-float px-2 text-xs font-medium"
          >
            <ListChecks size={14} />
            {roomy && "Review"}
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-bg-proposal px-1 text-[10px] text-fg-on-proposal">
              3
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border-float bg-bg-float p-0.5">
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
                  {roomy && PANES[pane].label}
                </button>
              );
            })}
          </div>
        </>
      )}
      <button
        type="button"
        className="h-8 shrink-0 rounded-md bg-bg-proposal px-3 text-xs font-medium text-fg-on-proposal"
      >
        Save
      </button>
      {!phone && (
        <>
          <span className="mx-1 h-5 w-px shrink-0 bg-border-float" />
          {desktop && <IconStub icon={ShieldCheck} label="No errors" />}
          {desktop && <IconStub icon={History} label="History" />}
          <IconStub icon={Bell} label="Notifications" />
          <Avatar />
        </>
      )}
    </div>
  );
}

function IconStub({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span
      title={label}
      aria-label={label}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-fg-secondary"
    >
      <Icon size={16} />
    </span>
  );
}

function Avatar({ initials = "FE" }: { initials?: string }) {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg-float-raised text-[10px] font-medium text-fg-primary ring-2 ring-bg-canvas">
      {initials}
    </span>
  );
}

/** Who else is in this proposal, and the way to invite more. */
function Members() {
  return (
    <span
      title="2 people in this proposal · Invite"
      className="flex shrink-0 items-center"
    >
      <Avatar initials="KN" />
      <span className="-ml-2">
        <Avatar initials="TL" />
      </span>
      <span className="ml-1 grid h-7 w-7 place-items-center rounded-full border border-dashed border-border-float text-fg-secondary">
        <UserPlus size={13} />
      </span>
    </span>
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
  const tab = state.contentTab;
  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-3 flex items-center gap-1 text-xs text-fg-secondary">
          <ChevronLeft size={13} />
          Blog
        </div>
        <h2 className="mb-4 text-base font-medium">Spring menu</h2>
        {tab === "content" ? (
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
          <span
            className={cn(
              "inline-flex items-center gap-1 self-start rounded border border-dashed px-1.5 py-0.5 text-[11px]",
              state.codeMode
                ? "border-border-proposal text-fg-proposal"
                : "border-border-brand-secondary text-fg-primary",
            )}
          >
            <MousePointerClick size={12} />
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
    if (!pickable(state, field)) return;
    if (state.selecting === "content" && field !== null) {
      update({ focused: field });
      controls.use("content");
    } else if (state.selecting === "chat") {
      update({ pointedAt: element, selecting: null });
      controls.use("chat");
    }
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
        <span
          className="inline-flex h-7 items-center gap-1 px-1 text-xs text-fg-secondary"
          title="Reload"
        >
          <RotateCw size={13} />
          {state.codeMode && !narrow && "Up to date"}
        </span>
      </div>
      {state.selecting !== null && (
        <div
          className={cn(
            "flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs",
            state.selecting === "content"
              ? "border-border-float text-fg-secondary"
              : state.codeMode
                ? "border-dashed border-border-proposal bg-bg-proposal-soft text-fg-proposal"
                : "border-dashed border-border-brand-secondary text-fg-primary",
          )}
        >
          {state.selecting === "content" ? (
            <MousePointerSquareDashed size={13} />
          ) : (
            <MousePointerClick size={13} />
          )}
          <span className="min-w-0 flex-1 truncate">
            {state.selecting === "content"
              ? "Click a field to edit it"
              : state.codeMode
                ? "Click anything to ask the assistant about it"
                : "Click a field to ask the assistant about it"}
          </span>
          <button
            type="button"
            onClick={() => update({ selecting: null })}
            className="font-medium hover:underline"
          >
            Done
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-bg-canvas p-3">
        <SitePage
          maxWidth={
            device === "mobile" ? 390 : device === "tablet" ? 834 : undefined
          }
          state={state}
          focused={state.focused}
          hovered={state.hovered ?? null}
          onPick={pick}
        />
      </div>
    </>
  );
}

/** Whether the Select that is on can take this element. */
function pickable(state: MockState, field: string | null): boolean {
  if (state.selecting === null) return false;
  if (state.selecting === "chat" && state.codeMode) return true;
  return field !== null;
}

/** The site in the preview: a restaurant's spring menu. */
function SitePage({
  maxWidth,
  state,
  focused,
  hovered,
  onPick,
}: {
  maxWidth?: number;
  state: MockState;
  focused: string | null;
  hovered: string | null;
  onPick: (field: string | null, element: string) => void;
}) {
  // Content's Select draws the fields it can open, solid. The Assistant's
  // draws nothing until hovered, dashed: in code mode it can take anything.
  const forContent = state.selecting === "content";
  const forChat = state.selecting === "chat";
  const pointColor = state.codeMode
    ? "hover:outline-border-proposal"
    : "hover:outline-border-brand-secondary";
  const el = (field: string | null, element: string) => {
    const can = pickable(state, field);
    return {
      onClick: () => onPick(field, element),
      className: cn(
        "rounded-sm",
        forContent &&
          field !== null &&
          "cursor-pointer outline outline-1 outline-offset-2 outline-[color-mix(in_srgb,var(--border-brand-secondary)_45%,transparent)]",
        forContent &&
          field !== null &&
          focused === field &&
          "outline-2 outline-border-brand-secondary",
        forChat &&
          can &&
          cn(
            "cursor-pointer hover:outline-dashed hover:outline-2 hover:-outline-offset-2",
            pointColor,
          ),
        forChat &&
          can &&
          hovered === element &&
          cn(
            "outline-dashed outline-2 -outline-offset-2",
            state.codeMode
              ? "outline-border-proposal"
              : "outline-border-brand-secondary",
          ),
      ),
    };
  };
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
        // Nothing in the footer is content: only the Assistant's Select, in
        // code mode, can pick it.
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
      <TopBarMock controls={controls} width={390} />
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
            {layout.pane === "content" ? (
              <ContentHeader controls={controls} width={366} />
            ) : (
              <SideHeader
                controls={controls}
                panes={[layout.pane]}
                front={layout.pane}
                width={366}
                select
              />
            )}
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
