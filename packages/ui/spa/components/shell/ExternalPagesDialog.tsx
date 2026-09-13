import {
  ComponentProps,
  ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  Earth,
  ExternalLink,
  Link2,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../designSystem/dialog";
import { Checkbox } from "../designSystem/checkbox";
import { Button } from "../designSystem/button";
import { cn } from "../designSystem/cn";
import { copyText } from "../../utils/copyText";
import { PanelFilterInput, PanelSkeleton } from "./PanelPrimitives";
import {
  ShellBreakpoint,
  ShellExternalPage,
  ShellExternalPageUsage,
} from "./types";
import {
  ExternalPageFilter,
  ExternalPageGroup,
  ExternalPageRowData,
  countStatuses,
  filterRows,
  flatRows,
  groupRows,
  toRows,
} from "./externalPageGroups";
import { checkExternalUrls, ExternalUrlIssue } from "./externalUrlChecks";

export type ExternalPagesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  breakpoint: ShellBreakpoint;
  pages: ShellExternalPage[];
  /** Open the entry in the editor, which closes the dialog. */
  onOpenEntry: (page: ShellExternalPage) => void;
  /** Open one of the places a URL is linked from. */
  onOpenUsage?: (usage: ShellExternalPageUsage) => void;
  /** Add a URL. Absent where the app cannot write. */
  onAddPage?: () => void;
  /** Remove a URL. Absent where the app cannot write. */
  onRemovePage?: (page: ShellExternalPage) => void;
  isLoading?: boolean;
  /**
   * Where the dialog portals to - the Studio's node inside the shadow root.
   *
   * A prop rather than `useValPortal()`, as everywhere else in the shell: a
   * dialog that reads the context cannot be rendered without the whole provider
   * tree, which is what a presentational component is for.
   */
  portalContainer?: HTMLElement | null;
};

/**
 * Every external URL the project has, in one place.
 *
 * The design starts from what the data is: a record whose KEYS are the URLs.
 * There is no title to sort by and no tree to walk - the list IS a list of
 * URLs, and its only structure is the one the URLs themselves carry. So the
 * list groups by registrable domain, which turns two dozen strangers into half
 * a dozen clusters someone recognises, and every row carries the two facts a
 * URL cannot show on its own: how many places link to it, and whether anything
 * is wrong with it.
 *
 * Master-detail rather than a dialog per URL. Reading what is behind a link is
 * the common move and it should not cost a second scrim - and once the detail
 * is a pane rather than a dialog, the same pane can hold the check report,
 * which is the one thing that is about several URLs at once.
 */
export function ExternalPagesDialog({
  open,
  onOpenChange,
  breakpoint,
  pages,
  onOpenEntry,
  onOpenUsage,
  onAddPage,
  onRemovePage,
  isLoading,
  portalContainer,
}: ExternalPagesDialogProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ExternalPageFilter>("all");
  const [grouped, setGrouped] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /**
   * The URLs the last press of Check was about.
   *
   * The checks themselves are pure and always computed - a row's badge never
   * waits for a button. What the button produces is the other half of a check,
   * the half a badge cannot express: a statement that these particular URLs
   * were looked at and these are fine. So the result is a list of URLs, not a
   * set of issues.
   */
  const [checked, setChecked] = useState<readonly string[] | null>(null);

  const issuesByUrl = useMemo(
    () => checkExternalUrls(pages.map((page) => page.url)),
    [pages],
  );
  const allRows = useMemo(
    () => toRows(pages, issuesByUrl),
    [pages, issuesByUrl],
  );
  const visible = useMemo(
    () => filterRows(allRows, query, filter),
    [allRows, query, filter],
  );
  const groups = useMemo(() => groupRows(visible), [visible]);
  const flat = useMemo(() => flatRows(visible), [visible]);
  const totals = useMemo(() => countStatuses(allRows), [allRows]);

  const openRow = useMemo(
    () => allRows.find((row) => row.page.url === openUrl) ?? null,
    [allRows, openUrl],
  );
  // Selection survives filtering, so a selection made across two filters is
  // still one selection - but the Check button must only ever act on rows that
  // are actually in front of you.
  const selectedVisible = useMemo(
    () => visible.filter((row) => selected.has(row.page.url)),
    [visible, selected],
  );
  const checkTargets = selectedVisible.length > 0 ? selectedVisible : visible;
  const checkedRows = useMemo(() => {
    if (checked === null) return null;
    const wanted = new Set(checked);
    return allRows.filter((row) => wanted.has(row.page.url));
  }, [checked, allRows]);

  // Reopening the dialog starts from the top. The filter, the selection and
  // whatever was open are all about one visit; carrying them over means the
  // second visit opens on a list that is mysteriously not the whole list.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setFilter("all");
    setSelected(new Set());
    setOpenUrl(null);
    setChecked(null);
  }, [open]);

  const isMobile = breakpoint === "mobile";
  // One pane at a time on a phone, both side by side everywhere else.
  const showDetail = !isMobile || openRow !== null || checkedRows !== null;
  const showList = !isMobile || !showDetail;

  const toggleSelected = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };
  const setManySelected = (urls: readonly string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const url of urls) {
        if (on) {
          next.add(url);
        } else {
          next.delete(url);
        }
      }
      return next;
    });
  };
  const openDetail = (url: string) => {
    setChecked(null);
    setOpenUrl(url);
  };

  const allVisibleSelected =
    visible.length > 0 && visible.every((row) => selected.has(row.page.url));
  const someVisibleSelected =
    !allVisibleSelected && visible.some((row) => selected.has(row.page.url));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={portalContainer}
        className={cn(
          "p-0 gap-0 overflow-hidden border-border-float bg-bg-float",
          "w-[min(60rem,calc(100vw-2rem))] max-w-none",
          "h-[min(42rem,calc(100vh-4rem))]",
          "grid grid-rows-[auto_auto_minmax(0,1fr)]",
        )}
      >
        <header className="flex items-center gap-2 h-12 px-4 border-b border-border-float">
          <Earth size={15} aria-hidden className="text-fg-secondary-alt" />
          <DialogTitle className="text-sm font-semibold">
            External pages
          </DialogTitle>
          <span className="text-xs text-fg-secondary-alt tabular-nums">
            {pages.length}
          </span>
          <DialogDescription className="sr-only">
            Every URL outside this site that its content links to, grouped by
            domain.
          </DialogDescription>
        </header>

        <Toolbar
          query={query}
          onQueryChange={setQuery}
          filter={filter}
          onFilterChange={setFilter}
          grouped={grouped}
          onGroupedChange={setGrouped}
          totals={totals}
          checkCount={checkTargets.length}
          onCheck={() => {
            setOpenUrl(null);
            setChecked(checkTargets.map((row) => row.page.url));
          }}
          onAddPage={onAddPage}
        />

        <div className="min-h-0 grid md:grid-cols-[minmax(0,1fr)_22rem]">
          {showList && (
            <div className="min-h-0 overflow-y-auto border-r border-border-float">
              {isLoading ? (
                <PanelSkeleton rows={10} />
              ) : allRows.length === 0 ? (
                <EmptyList>
                  No external pages yet. They are the URLs outside this site
                  that its content links to.
                </EmptyList>
              ) : visible.length === 0 ? (
                <EmptyList>Nothing matches this filter.</EmptyList>
              ) : (
                <>
                  <div className="flex items-center gap-2 h-8 px-4 border-b border-border-float">
                    <RowCheckbox
                      checked={
                        allVisibleSelected
                          ? true
                          : someVisibleSelected
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={(next) =>
                        setManySelected(
                          visible.map((row) => row.page.url),
                          next === true,
                        )
                      }
                      aria-label={`Select all ${visible.length} URLs`}
                    />
                    <span className="text-[0.6875rem] uppercase tracking-wide text-fg-secondary-alt">
                      {selected.size > 0
                        ? `${selected.size} selected`
                        : `${visible.length} URL${visible.length === 1 ? "" : "s"}`}
                    </span>
                    {selected.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelected(new Set())}
                        className="ml-auto text-[0.6875rem] text-fg-secondary-alt hover:text-fg-primary"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {grouped
                    ? groups.map((group) => (
                        <Group
                          key={group.domain}
                          group={group}
                          collapsed={collapsed.has(group.domain)}
                          onToggleCollapsed={() =>
                            setCollapsed((prev) => {
                              const next = new Set(prev);
                              if (next.has(group.domain)) {
                                next.delete(group.domain);
                              } else {
                                next.add(group.domain);
                              }
                              return next;
                            })
                          }
                          selected={selected}
                          onToggleRow={toggleSelected}
                          onToggleGroup={(on) =>
                            setManySelected(
                              group.rows.map((row) => row.page.url),
                              on,
                            )
                          }
                          openUrl={openUrl}
                          onOpen={openDetail}
                          showHost={false}
                        />
                      ))
                    : flat.map((row) => (
                        <Row
                          key={row.page.url}
                          row={row}
                          selected={selected.has(row.page.url)}
                          onToggle={() => toggleSelected(row.page.url)}
                          isOpen={openUrl === row.page.url}
                          onOpen={() => openDetail(row.page.url)}
                          showHost
                        />
                      ))}
                </>
              )}
            </div>
          )}

          {showDetail && (
            <div className="min-h-0 overflow-y-auto bg-bg-float-raised">
              {isMobile && (
                <button
                  type="button"
                  onClick={() => {
                    setOpenUrl(null);
                    setChecked(null);
                  }}
                  className="flex items-center gap-1.5 h-9 px-4 w-full text-xs text-fg-secondary hover:text-fg-primary"
                >
                  <ArrowLeft size={14} aria-hidden />
                  All external pages
                </button>
              )}
              {checkedRows !== null ? (
                <CheckReport
                  rows={checkedRows}
                  onOpen={openDetail}
                  onDismiss={() => setChecked(null)}
                />
              ) : openRow !== null ? (
                <EntryDetail
                  row={openRow}
                  onOpenEntry={() => {
                    onOpenEntry(openRow.page);
                    onOpenChange(false);
                  }}
                  onOpenUsage={
                    onOpenUsage &&
                    ((usage: ShellExternalPageUsage) => {
                      onOpenUsage(usage);
                      onOpenChange(false);
                    })
                  }
                  onRemove={onRemovePage && (() => onRemovePage(openRow.page))}
                />
              ) : (
                <DetailPlaceholder />
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The shared `Checkbox` with a border you can see.
 *
 * Its default is `bg-bg-primary border-primary-foreground`, which in the light
 * theme is #fcfcfc on #fafafa: on a light panel the box is invisible until it
 * is ticked, and a multi-select list whose checkboxes cannot be found is not a
 * multi-select list. Overridden here rather than in the design system because
 * that component is on every surface in the Studio and this is not the place to
 * change all of them - but it is the same bug wherever it is drawn on a pale
 * background.
 */
function RowCheckbox(props: ComponentProps<typeof Checkbox>) {
  return <Checkbox {...props} className="border-border-primary" />;
}

function Toolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  grouped,
  onGroupedChange,
  totals,
  checkCount,
  onCheck,
  onAddPage,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  filter: ExternalPageFilter;
  onFilterChange: (value: ExternalPageFilter) => void;
  grouped: boolean;
  onGroupedChange: (value: boolean) => void;
  totals: { ok: number; warning: number; error: number };
  checkCount: number;
  onCheck: () => void;
  onAddPage?: () => void;
}) {
  const flagged = totals.warning + totals.error;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border-float">
      <div className="w-48 shrink-0">
        <PanelFilterInput
          value={query}
          onChange={onQueryChange}
          placeholder="Filter URLs…"
        />
      </div>
      <SegmentedControl
        label="Show"
        value={filter}
        onChange={onFilterChange}
        options={[
          { value: "all", label: "All" },
          { value: "unused", label: "Unused" },
          {
            value: "issues",
            label: `Flagged${flagged > 0 ? ` ${flagged}` : ""}`,
          },
        ]}
      />
      <SegmentedControl
        label="Group"
        value={grouped ? "host" : "none"}
        onChange={(value) => onGroupedChange(value === "host")}
        options={[
          { value: "host", label: "By domain" },
          { value: "none", label: "Flat" },
        ]}
      />
      <div className="ml-auto flex items-center gap-2">
        {onAddPage && (
          <Button size="sm" variant="ghost" onClick={onAddPage}>
            <Plus size={14} className="mr-1" aria-hidden />
            Add URL
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={onCheck}
          disabled={checkCount === 0}
        >
          <ShieldCheck size={14} className="mr-1" aria-hidden />
          Check {checkCount}
        </Button>
      </div>
    </div>
  );
}

/**
 * Typed against its own option values rather than `string`, so a caller cannot
 * hand back a value the `onChange` does not accept.
 */
function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center p-0.5 rounded-md bg-bg-float-raised"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-6 px-2 rounded text-[0.6875rem] font-medium",
            option.value === value
              ? "bg-bg-float text-fg-primary"
              : "text-fg-secondary-alt hover:text-fg-primary",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Group({
  group,
  collapsed,
  onToggleCollapsed,
  selected,
  onToggleRow,
  onToggleGroup,
  openUrl,
  onOpen,
  showHost,
}: {
  group: ExternalPageGroup;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  selected: ReadonlySet<string>;
  onToggleRow: (url: string) => void;
  onToggleGroup: (on: boolean) => void;
  openUrl: string | null;
  onOpen: (url: string) => void;
  showHost: boolean;
}) {
  const all = group.rows.every((row) => selected.has(row.page.url));
  const some = !all && group.rows.some((row) => selected.has(row.page.url));
  const flagged = group.rows.filter((row) => row.status !== "ok").length;
  return (
    <section>
      <div className="flex items-center gap-2 h-8 px-4 sticky top-0 bg-bg-float">
        <RowCheckbox
          checked={all ? true : some ? "indeterminate" : false}
          onCheckedChange={(next) => onToggleGroup(next === true)}
          aria-label={`Select the ${group.rows.length} URLs on ${group.domain}`}
        />
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className="flex items-center gap-1 min-w-0 flex-1 text-xs text-fg-primary"
        >
          {collapsed ? (
            <ChevronRight size={12} aria-hidden />
          ) : (
            <ChevronDown size={12} aria-hidden />
          )}
          <span className="truncate font-medium">{group.domain}</span>
          <span className="text-fg-secondary-alt tabular-nums">
            {group.rows.length}
          </span>
          {flagged > 0 && (
            <AlertTriangle
              size={12}
              aria-hidden
              className="text-fg-warning-primary"
            />
          )}
        </button>
      </div>
      {!collapsed &&
        group.rows.map((row) => (
          <Row
            key={row.page.url}
            row={row}
            selected={selected.has(row.page.url)}
            onToggle={() => onToggleRow(row.page.url)}
            isOpen={openUrl === row.page.url}
            onOpen={() => onOpen(row.page.url)}
            showHost={showHost}
            indented
          />
        ))}
    </section>
  );
}

/**
 * One URL.
 *
 * Everything but the URL itself is `aria-hidden` and moved into a description
 * the button points at, for the reason `PanelRow` records: a badge inside the
 * button becomes part of its ACCESSIBLE NAME, so the row announces itself as
 * "/valbuild/reels unused" and every `getByRole("button", { name })` that
 * matches it stops matching the moment a link is used or an error appears.
 * The name is the URL; the state is a description.
 */
function Row({
  row,
  selected,
  onToggle,
  isOpen,
  onOpen,
  showHost,
  indented,
}: {
  row: ExternalPageRowData;
  selected: boolean;
  onToggle: () => void;
  isOpen: boolean;
  onOpen: () => void;
  showHost: boolean;
  indented?: boolean;
}) {
  const { page, parsed, status, usageCount, issues } = row;
  const notesId = useId();
  const notes = [
    usageCount === null
      ? "Still counting where this is used"
      : usageCount === 0
        ? "Nothing links to this"
        : `Linked from ${usageCount} place${usageCount === 1 ? "" : "s"}`,
    page.errorCount !== undefined && page.errorCount > 0
      ? `${page.errorCount} validation error${page.errorCount === 1 ? "" : "s"}`
      : null,
    ...issues.map((issue) => issue.message),
  ].filter((note): note is string => note !== null);
  return (
    <div
      className={cn("flex items-center gap-2 pr-3", indented ? "pl-9" : "pl-4")}
    >
      <RowCheckbox
        checked={selected}
        onCheckedChange={onToggle}
        aria-label={`Select ${page.url}`}
      />
      <button
        type="button"
        onClick={onOpen}
        aria-current={isOpen ? "true" : undefined}
        aria-describedby={notesId}
        title={page.url}
        className={cn(
          "flex items-center gap-2 min-w-0 flex-1 h-7 px-1.5 rounded-md text-xs text-left",
          isOpen
            ? "bg-bg-float-raised text-fg-primary"
            : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
        )}
      >
        <StatusIcon status={status} issues={issues} />
        <span className="truncate font-mono text-[0.6875rem]">
          {showHost ? page.url : parsed.label}
        </span>
        <span id={notesId} hidden>
          {notes.join(", ")}
        </span>
        <span aria-hidden className="ml-auto shrink-0 flex items-center gap-2">
          <UsageBadge count={usageCount} />
          {page.errorCount !== undefined && page.errorCount > 0 && (
            <span
              title={`${page.errorCount} validation error${page.errorCount === 1 ? "" : "s"}`}
              className="min-w-[1rem] h-4 px-1 grid place-items-center rounded bg-bg-error-primary text-fg-error-primary text-[0.625rem] font-semibold tabular-nums"
            >
              {page.errorCount}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

/**
 * How many places link here - the fact a list of URLs cannot show and the one
 * that decides what you do with a row.
 *
 * Three states, not two: `null` is a scan that has not answered yet, and it
 * says so rather than showing a 0 that reads as "safe to delete".
 */
function UsageBadge({ count }: { count: number | null }) {
  if (count === null) {
    return (
      <span className="text-[0.625rem] text-fg-secondary-alt">counting…</span>
    );
  }
  if (count === 0) {
    return (
      <span className="px-1 h-4 grid place-items-center rounded bg-bg-float-raised text-[0.625rem] text-fg-secondary-alt">
        unused
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-0.5 text-[0.625rem] text-fg-secondary-alt tabular-nums"
      title={`Linked from ${count} place${count === 1 ? "" : "s"}`}
    >
      <Link2 size={10} aria-hidden />
      {count}
    </span>
  );
}

/**
 * A row's one status mark.
 *
 * Entirely decorative: the messages it stands for are in the row's own
 * description (see {@link Row}) and, in the report, written out beneath it.
 * A `title` still puts them under the pointer.
 */
function StatusIcon({
  status,
  issues,
}: {
  status: ExternalPageRowData["status"];
  issues: readonly ExternalUrlIssue[];
}) {
  if (status === "ok") {
    return (
      <ExternalLink size={12} aria-hidden className="shrink-0 opacity-40" />
    );
  }
  const Icon = status === "error" ? CircleAlert : AlertTriangle;
  return (
    <span
      aria-hidden
      title={issues.map((issue) => issue.message).join(" ")}
      className={cn(
        "shrink-0 inline-grid place-items-center",
        status === "error"
          ? "text-fg-error-on-surface"
          : "text-fg-warning-primary",
      )}
    >
      <Icon size={12} />
    </span>
  );
}

function DetailPlaceholder() {
  return (
    <div className="h-full grid place-items-center p-8 text-center">
      <p className="text-xs text-fg-secondary-alt max-w-[16rem]">
        Pick a URL to see what is behind it, and where the site links to it.
      </p>
    </div>
  );
}

function EmptyList({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-8 text-xs text-fg-secondary-alt text-center">
      {children}
    </p>
  );
}

function EntryDetail({
  row,
  onOpenEntry,
  onOpenUsage,
  onRemove,
}: {
  row: ExternalPageRowData;
  onOpenEntry: () => void;
  onOpenUsage?: (usage: ShellExternalPageUsage) => void;
  onRemove?: () => void;
}) {
  const { page, issues, usageCount } = row;
  return (
    <div className="p-4 space-y-5">
      <div className="space-y-2">
        <div className="flex items-start gap-1.5">
          <p className="min-w-0 flex-1 font-mono text-[0.6875rem] leading-5 text-fg-primary break-all">
            {page.url}
          </p>
          <CopyButton value={page.url} />
          <a
            href={page.url}
            target="_blank"
            rel="noreferrer noopener"
            title="Open in a new tab"
            className="shrink-0 grid place-items-center w-6 h-6 rounded text-fg-secondary-alt hover:text-fg-primary hover:bg-bg-float-raised"
          >
            <ExternalLink size={12} aria-hidden />
            <span className="sr-only">Open {page.url} in a new tab</span>
          </a>
        </div>
      </div>

      <Section title="Checks">
        <IssueList issues={issues} />
      </Section>

      <Section title="Value">
        {page.fields === undefined ? (
          <p className="text-xs text-fg-secondary-alt">Loading…</p>
        ) : page.fields.length === 0 ? (
          <p className="text-xs text-fg-secondary-alt">
            This router stores nothing but the URL.
          </p>
        ) : (
          <dl className="space-y-1.5">
            {page.fields.map((field) => (
              <div
                key={field.label}
                className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2"
              >
                <dt className="text-[0.6875rem] text-fg-secondary-alt truncate">
                  {field.label}
                </dt>
                <dd className="text-xs text-fg-primary break-words">
                  {field.value === "" ? (
                    <span className="text-fg-secondary-alt">empty</span>
                  ) : (
                    field.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section
        title={
          usageCount === null
            ? "Used in"
            : `Used in ${usageCount} place${usageCount === 1 ? "" : "s"}`
        }
      >
        {usageCount === null ? (
          <p className="text-xs text-fg-secondary-alt">
            Still looking through the project…
          </p>
        ) : usageCount === 0 ? (
          <p className="text-xs text-fg-secondary-alt">
            Nothing links to this URL.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {(page.usages ?? []).map((usage) => (
              <li key={usage.sourcePath}>
                <button
                  type="button"
                  disabled={onOpenUsage === undefined}
                  onClick={() => onOpenUsage?.(usage)}
                  className={cn(
                    "w-full text-left px-1.5 py-1 rounded text-xs",
                    onOpenUsage
                      ? "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
                      : "text-fg-secondary",
                  )}
                >
                  <span className="block truncate">{usage.label}</span>
                  <span className="block truncate text-[0.625rem] text-fg-secondary-alt font-mono">
                    {usage.moduleFilePath}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="secondary" onClick={onOpenEntry}>
          Open in editor
        </Button>
        {onRemove && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRemove}
            // Only where nothing points at it. The usage list is the check -
            // that is what it is for - and an incomplete scan (`null`) is not
            // an answer, so it blocks the delete too.
            disabled={usageCount !== 0}
            title={
              usageCount === 0
                ? undefined
                : "Remove the links to this URL first"
            }
          >
            <Trash2 size={14} className="mr-1" aria-hidden />
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[0.6875rem] uppercase tracking-wide text-fg-secondary-alt">
        {title}
      </h3>
      {children}
    </section>
  );
}

function IssueList({ issues }: { issues: readonly ExternalUrlIssue[] }) {
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
        <CircleCheck size={12} aria-hidden className="text-fg-brand-primary" />
        Nothing wrong with this URL.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {issues.map((issue) => (
        <li key={issue.code} className="flex items-start gap-1.5 text-xs">
          {issue.severity === "error" ? (
            <CircleAlert
              size={12}
              aria-hidden
              className="mt-0.5 shrink-0 text-fg-error-on-surface"
            />
          ) : (
            <AlertTriangle
              size={12}
              aria-hidden
              className="mt-0.5 shrink-0 text-fg-warning-primary"
            />
          )}
          <span className="text-fg-secondary">{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the Check button produces.
 *
 * The point of it is the clean rows: a badge can say "something is wrong here",
 * but only a report can say "these eleven were looked at and they are fine",
 * and that is the answer someone pressing a Check button wants.
 */
function CheckReport({
  rows,
  onOpen,
  onDismiss,
}: {
  rows: readonly ExternalPageRowData[];
  onOpen: (url: string) => void;
  onDismiss: () => void;
}) {
  const totals = countStatuses(rows);
  return (
    <div className="p-4 space-y-4">
      <div className="space-y-1">
        <h3 className="text-xs font-semibold text-fg-primary">
          Checked {rows.length} URL{rows.length === 1 ? "" : "s"}
        </h3>
        <p className="text-[0.6875rem] text-fg-secondary-alt">
          {totals.error > 0 && `${totals.error} with errors · `}
          {totals.warning > 0 && `${totals.warning} worth a look · `}
          {totals.ok} fine
        </p>
        <p className="text-[0.6875rem] text-fg-secondary-alt">
          These checks read the URLs; they do not open them, so a link that has
          gone dead still looks fine here.
        </p>
      </div>
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.page.url} className="space-y-1">
            <button
              type="button"
              onClick={() => onOpen(row.page.url)}
              className="flex items-start gap-1.5 w-full text-left"
            >
              <StatusIcon status={row.status} issues={row.issues} />
              <span className="min-w-0 font-mono text-[0.625rem] leading-4 text-fg-secondary break-all hover:text-fg-primary">
                {row.page.url}
              </span>
            </button>
            {row.issues.length === 0 ? (
              <p className="pl-5 text-[0.6875rem] text-fg-secondary-alt">
                No issues.
              </p>
            ) : (
              <ul className="pl-5 space-y-1">
                {row.issues.map((issue) => (
                  <li
                    key={issue.code}
                    className="text-[0.6875rem] text-fg-secondary"
                  >
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Done
      </Button>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      title="Copy URL"
      onClick={() => {
        copyText(value);
        setCopied(true);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1200);
      }}
      className="shrink-0 grid place-items-center w-6 h-6 rounded text-fg-secondary-alt hover:text-fg-primary hover:bg-bg-float-raised"
    >
      {copied ? (
        <Check size={12} aria-hidden />
      ) : (
        <Copy size={12} aria-hidden />
      )}
      <span className="sr-only">{copied ? "Copied" : "Copy URL"}</span>
    </button>
  );
}
