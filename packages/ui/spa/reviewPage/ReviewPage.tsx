import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  Code2,
  Columns2,
  File,
  History,
  Rows3,
  Sparkles,
} from "lucide-react";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/designSystem/button";
import { cn } from "../components/designSystem/cn";
import { ChangeKindIcon, changeKindLabel } from "../compare/ChangeKindIcon";
import { CompareNav } from "../compare/CompareNav";
import type { ComparePageView } from "../compare/types";
import { DiffFields } from "../diff/DiffValue";
import type { DiffLayout, FieldDiff } from "../diff/types";
import { codeSummary, ReviewCodePane } from "./ReviewCodePane";
import { ReviewPagePane, Segmented, SideHeading } from "./ReviewPagePane";
import {
  REVIEW_CODE_ID,
  reviewPageId,
  type ReviewAffectedPage,
  type ReviewPageModel,
  type ReviewPane,
  type ReviewRow,
} from "./types";

/**
 * Review, as a page: what is about to go out, shown as what changed.
 *
 * It used to be two things. A list of what is pending, with a button that
 * opened the differences in a dialog over it. The differences are what a
 * reviewer came for, so they are the page now, and the list of steps with its
 * revert controls is a page of its own (`ChangesView`), one click from here
 * and one click from every change.
 *
 * Read-only by design. Nothing on this page destroys anything: reverting is
 * done where the steps are, which is where it can say what else goes with it.
 */
export function ReviewPage({
  model,
  publish,
  onOpenChanges,
  onOpenSession,
  renderPage,
  initialLayout = "inline",
  initialSelected,
  initialView = "fields",
}: {
  model: ReviewPageModel;
  /** The button that finishes the job: Publish, or Save in a local project. */
  publish: { label: string; onPublish: () => void };
  /**
   * Go to the steps behind the changes, where they can be reverted: all of
   * them (`null`), or the ones that made one change.
   */
  onOpenChanges: (rowId: string | null) => void;
  /** Open a chat with the assistant that made a change. */
  onOpenSession?: (sessionId: string) => void;
  /** Draw one side of a page. Absent: pages cannot be looked at as pages. */
  renderPage?: (page: ComparePageView) => ReactNode;
  initialLayout?: DiffLayout;
  /** A nav node id, `REVIEW_CODE_ID`, or `reviewPageId(url)`. */
  initialSelected?: string;
  initialView?: "fields" | "page";
}) {
  const [layout, setLayout] = useState<DiffLayout>(initialLayout);
  const [selected, setSelected] = useState<string | null>(
    initialSelected ?? firstSelectable(model),
  );
  const [view, setView] = useState<"fields" | "page">(initialView);

  const pane = selected === null ? undefined : model.panes[selected];
  const showingCode = selected === REVIEW_CODE_ID && model.code !== undefined;
  const pageOnly =
    selected !== null && selected.startsWith("page:")
      ? selected.slice("page:".length)
      : null;
  const empty =
    model.changeCount === 0 &&
    model.code === undefined &&
    model.affected === undefined;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg-primary text-fg-primary">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-primary px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">Review</h1>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-fg-secondary">
            <span className="truncate">{model.left.label}</span>
            <ArrowRight size={12} className="shrink-0" aria-hidden />
            <span className="sr-only">compared with</span>
            <span className="truncate">{model.right.label}</span>
            <span className="truncate text-fg-tertiary">
              · {summaryOf(model)}
            </span>
          </p>
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          <Segmented
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: "inline", label: "Inline", icon: <Rows3 size={13} /> },
              {
                value: "split",
                label: "Side by side",
                icon: <Columns2 size={13} />,
              },
            ]}
          />
          <Button
            size="xs"
            variant="secondary"
            onClick={() => onOpenChanges(null)}
          >
            <History size={14} aria-hidden />
            Changes and revert
          </Button>
          <Button size="xs" onClick={publish.onPublish} disabled={empty}>
            {publish.label}
          </Button>
        </div>
      </header>

      {empty ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-16">
          <p className="max-w-sm text-center text-sm text-fg-tertiary">
            Nothing to review. Changes you make show up here before they are
            published.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="max-h-56 shrink-0 overflow-y-auto border-b border-border-primary p-3 md:max-h-none md:w-64 md:border-b-0 md:border-r">
            {model.sections.length > 0 && (
              <CompareNav
                sections={model.sections}
                selectedId={selected}
                onSelect={(id) => {
                  setSelected(id);
                }}
                className="overflow-visible"
              />
            )}
            {model.code !== undefined && (
              <NavGroup title="Code">
                <NavButton
                  selected={showingCode}
                  onClick={() => setSelected(REVIEW_CODE_ID)}
                  icon={<Code2 size={14} aria-hidden />}
                  label={codeSummary(model.code)}
                />
              </NavGroup>
            )}
            {renderPage !== undefined && model.affected !== undefined && (
              <AffectedNav
                affected={model.affected}
                selected={selected}
                onSelect={setSelected}
              />
            )}
            {renderPage !== undefined && (
              <AnyPage onOpen={(url) => setSelected(reviewPageId(url))} />
            )}
          </aside>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            {showingCode && model.code !== undefined ? (
              <PaneFrame
                title="Code changes"
                location={codeSummary(model.code)}
                end={
                  <span className="text-xs text-fg-secondary">
                    {model.code.build}
                  </span>
                }
              >
                <ReviewCodePane
                  code={model.code}
                  onOpenSession={onOpenSession}
                />
              </PaneFrame>
            ) : pageOnly !== null && renderPage !== undefined ? (
              <PaneFrame title={pageOnly} location="No content changed here">
                <ReviewPagePane
                  url={pageOnly}
                  left={model.left}
                  right={model.right}
                  renderPage={renderPage}
                />
              </PaneFrame>
            ) : pane !== undefined ? (
              <ContentPane
                pane={pane}
                model={model}
                layout={layout}
                view={
                  pane.pageUrl !== undefined && renderPage ? view : "fields"
                }
                onViewChange={setView}
                renderPage={renderPage}
                onOpenChanges={onOpenChanges}
                onOpenSession={onOpenSession}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-sm text-fg-tertiary">
                Choose something on the left to see what changed.
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function firstSelectable(model: ReviewPageModel): string | null {
  for (const section of model.sections) {
    const stack = [...section.nodes];
    while (stack.length > 0) {
      const node = stack.shift();
      if (node === undefined) continue;
      if (model.panes[node.id] !== undefined) return node.id;
      stack.unshift(...(node.children ?? []));
    }
  }
  return model.code !== undefined ? REVIEW_CODE_ID : null;
}

/** `7 changes · code`: what there is, before reading any of it. */
function summaryOf(model: ReviewPageModel): string {
  const parts: string[] = [];
  if (model.changeCount > 0) {
    parts.push(
      `${model.changeCount} ${model.changeCount === 1 ? "change" : "changes"}`,
    );
  }
  if (model.code !== undefined) parts.push("code");
  return parts.length === 0 ? "nothing changed" : parts.join(" · ");
}

/* ------------------------------------------------------------------- nav */

function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
        {title}
      </div>
      {children}
    </div>
  );
}

function NavButton({
  selected,
  onClick,
  icon,
  label,
  note,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  note?: string;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left text-sm",
        selected
          ? "bg-bg-secondary font-medium text-fg-primary"
          : "text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
      )}
    >
      <span className="shrink-0 text-fg-tertiary">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      {note !== undefined && (
        <span className="ml-auto min-w-0 shrink truncate pl-2 text-xs font-normal text-fg-tertiary">
          {note}
        </span>
      )}
    </button>
  );
}

/**
 * Pages whose content did not change, and that may look different anyway.
 *
 * The two lists are headed by how sure they are, because that is what decides
 * whether a reviewer opens one: a page that reads changed content HAS changed,
 * and a page that imports a changed file may not have.
 */
function AffectedNav({
  affected,
  selected,
  onSelect,
}: {
  affected: NonNullable<ReviewPageModel["affected"]>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const list = (pages: ReviewAffectedPage[]): ReactNode =>
    pages.map((page) => (
      <NavButton
        key={page.url}
        selected={selected === reviewPageId(page.url)}
        onClick={() => onSelect(reviewPageId(page.url))}
        icon={<File size={14} aria-hidden />}
        label={page.url}
        note={page.because}
      />
    ));
  return (
    <>
      {affected.byContent.length > 0 && (
        <NavGroup title="Shows changed content">
          {list(affected.byContent)}
        </NavGroup>
      )}
      {(affected.byCode.length > 0 ||
        affected.everyPageBecause !== undefined) && (
        <NavGroup title="Code may affect">
          {list(affected.byCode)}
          {affected.everyPageBecause !== undefined && (
            <p className="px-2 py-1 text-xs text-fg-tertiary">
              Every page loads {affected.everyPageBecause}, so any page may look
              different.
            </p>
          )}
        </NavGroup>
      )}
    </>
  );
}

/** Look at a page nothing above lists. */
function AnyPage({ onOpen }: { onOpen: (url: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <NavGroup title="Any page">
      <form
        className="flex gap-1 px-1"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = value.trim();
          if (trimmed === "") return;
          onOpen(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
        }}
      >
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="/a-page"
          aria-label="The page's address"
          className="h-7 min-w-0 flex-1 rounded border border-border-secondary bg-bg-primary px-2 text-xs text-fg-primary placeholder:text-fg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        />
        <button
          type="submit"
          className="h-7 shrink-0 rounded border border-border-secondary px-2 text-xs font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
        >
          Compare
        </button>
      </form>
    </NavGroup>
  );
}

/* ------------------------------------------------------------------ pane */

function PaneFrame({
  title,
  location,
  start,
  end,
  children,
}: {
  title: string;
  location?: string;
  start?: ReactNode;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-5 pb-3 pt-4">
        {start}
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          {location !== undefined && (
            <p className="truncate text-xs text-fg-tertiary">{location}</p>
          )}
        </div>
        {end !== undefined && (
          <div className="ml-auto flex shrink-0 items-center gap-2">{end}</div>
        )}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-5 pb-8">
        {children}
      </div>
    </div>
  );
}

function ContentPane({
  pane,
  model,
  layout,
  view,
  onViewChange,
  renderPage,
  onOpenChanges,
  onOpenSession,
}: {
  pane: ReviewPane;
  model: ReviewPageModel;
  layout: DiffLayout;
  view: "fields" | "page";
  onViewChange: (view: "fields" | "page") => void;
  renderPage?: (page: ComparePageView) => ReactNode;
  onOpenChanges: (rowId: string | null) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const rowsById = new Map(pane.rows.map((row) => [row.id, row]));
  const canShowPage = pane.pageUrl !== undefined && renderPage !== undefined;
  return (
    <PaneFrame
      title={pane.title}
      location={
        pane.renamedFrom !== undefined
          ? `${pane.location ?? pane.title}, was ${pane.renamedFrom}`
          : pane.location
      }
      start={
        pane.change !== undefined && pane.change !== "changed" ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-secondary px-2 py-0.5 text-xs text-fg-secondary">
            <ChangeKindIcon kind={pane.change} size={12} hideLabel />
            {changeKindLabel(pane.change)}
          </span>
        ) : undefined
      }
      end={
        canShowPage ? (
          <Segmented
            label="Show"
            value={view}
            onChange={onViewChange}
            options={[
              { value: "fields", label: "Fields" },
              { value: "page", label: "Page" },
            ]}
          />
        ) : undefined
      }
    >
      {view === "page" && canShowPage && pane.pageUrl !== undefined ? (
        <ReviewPagePane
          url={pane.pageUrl}
          left={model.left}
          right={model.right}
          renderPage={renderPage}
        />
      ) : (
        <>
          {layout === "split" && (
            <div className="sticky top-0 z-10 mb-4 grid grid-cols-2 gap-4 border-b border-border-secondary bg-bg-primary py-2">
              <SideHeading side={model.left} />
              <SideHeading side={model.right} />
            </div>
          )}
          <DiffFields
            fields={pane.rows}
            layout={layout}
            renderMeta={(field) => (
              <RowMeta
                row={rowsById.get(field.id)}
                field={field}
                model={model}
                onOpenChanges={onOpenChanges}
                onOpenSession={onOpenSession}
              />
            )}
          />
        </>
      )}
    </PaneFrame>
  );
}

/**
 * Who made a change, and the way to the steps behind it.
 *
 * The history link is on every row because it is where reverting is: Review
 * itself changes nothing, so the answer to "I do not want this one" has to be
 * one click from the change it is about.
 */
function RowMeta({
  row,
  field,
  model,
  onOpenChanges,
  onOpenSession,
}: {
  row: ReviewRow | undefined;
  field: FieldDiff;
  model: ReviewPageModel;
  onOpenChanges: (rowId: string | null) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  if (row === undefined) return null;
  const session = row.session;
  return (
    <>
      {session !== undefined &&
        (onOpenSession !== undefined ? (
          <button
            type="button"
            onClick={() => onOpenSession(session.id)}
            title={`Made by the assistant in "${session.title}". Open the chat.`}
            className="inline-flex h-6 max-w-40 items-center gap-1 rounded-full border border-border-secondary px-2 text-xs text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
          >
            <Sparkles size={12} className="shrink-0" aria-hidden />
            <span className="truncate">{session.title}</span>
          </button>
        ) : (
          <span
            title={`Made by the assistant in "${session.title}"`}
            className="inline-flex h-6 max-w-40 items-center gap-1 rounded-full border border-border-secondary px-2 text-xs text-fg-secondary"
          >
            <Sparkles size={12} className="shrink-0" aria-hidden />
            <span className="truncate">{session.title}</span>
          </span>
        ))}
      <span className="flex -space-x-1.5">
        {row.authorIds.map((id) => {
          const profile = model.profiles[id];
          return (
            <Avatar
              key={id}
              size="xs"
              name={profile?.fullName ?? null}
              imageUrl={profile?.avatar?.url}
              className="ring-2 ring-bg-primary"
            />
          );
        })}
      </span>
      <button
        type="button"
        onClick={() => onOpenChanges(field.id)}
        title="See the steps behind this change, and revert them"
        className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-fg-tertiary hover:bg-bg-secondary hover:text-fg-primary"
      >
        <History size={12} aria-hidden />
        History
      </button>
    </>
  );
}
