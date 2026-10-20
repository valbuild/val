import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode2,
  Globe,
  Loader2,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import classNames from "classnames";
import { urlOf } from "@valbuild/shared/internal";
import { Button } from "../designSystem/button";

/**
 * `/val/validate`: the Studio's errors page, grown so it can also run the
 * whole of `val validate`. See `docs/plans/studio-validate.md`, "Sketches".
 *
 * A view and nothing else: it is handed rows and the state of the full check,
 * and reports what was pressed. Reading the Studio's own errors, calling
 * `/validate` module by module and turning a returned patch into a pending
 * change belong to the container, so that every state below can be shown in
 * Storybook without a server.
 */
export type ValidatePageViewProps = {
  groups: ValidateGroup[];
  fullCheck: FullCheckState;
  onCheckEverything: () => void;
  onStop: () => void;
  onFixEverything: () => void;
  onFixGroup: (groupId: string) => void;
  onRowAction: (rowId: string, action: RowActionName) => void;
};

/** A module, or the project-wide "Remote files" group. */
export type ValidateGroup = {
  id: string;
  title: string;
  /** What kind of thing the module is, when that helps: "imagedir". */
  kind?: string;
  /** The project-wide group for hosts, rather than one module. */
  remote?: boolean;
  /** Not checked yet in this run, or checked: drives the running list. */
  rows: ValidateRow[];
};

export type ValidateRow = {
  id: string;
  /** Where it is: a route and a field, or a file path. Never a title. */
  location: string;
  message: string;
  /** `fixable` rows can be fixed from here; `error` rows cannot. */
  tone: "error" | "fixable";
  /** Said beside the location, e.g. "in your unpublished changes". */
  note?: string;
  /** For support: shown under "Details", never instead of the message. */
  details?: string;
  action: RowAction;
  /**
   * What the row shows under its message: the field itself, so an error in
   * the content can be fixed where it is listed, as the errors page always
   * let you. Absent in Storybook and for errors that have no field to edit.
   */
  body?: ReactNode;
  /** What has happened to the row's fix, once one was asked for. */
  fixState?: FixState;
};

export type RowAction =
  | { kind: "fix"; label?: string }
  | { kind: "open" }
  | { kind: "remove-from-set" }
  | { kind: "try-again-or-remove" }
  /** Asks again: for a host that did not answer, which may answer now. */
  | { kind: "try-again" }
  | { kind: "check-module" }
  | { kind: "command"; command: string };

export type RowActionName =
  | "fix"
  | "open"
  | "remove-from-set"
  | "try-again"
  | "remove"
  | "check-module"
  | "copy"
  | "review"
  | "undo";

/**
 * What a person can do about a failure, offered beside it. `try-again` only
 * where trying again can answer differently: a server that could not be
 * reached, or answered 5xx. A refusal that will be the same next time offers
 * nothing, and a session that ended offers **Sign in**.
 */
export type FailureAction = "try-again" | "sign-in" | "none";

export type FixState =
  | { status: "fixing" }
  /** Fixed in place, by editing the field the row shows. */
  | { status: "resolved" }
  | { status: "fixed"; summary: string }
  | { status: "failed"; message: string; action?: FailureAction };

export type FullCheckState =
  | { status: "not-run" }
  | {
      status: "running";
      checked: number;
      total: number;
      modules: { title: string; state: "checked" | "checking" | "waiting" }[];
    }
  | { status: "done"; checkedAgo: string }
  | { status: "stopped"; checked: number; total: number }
  | {
      status: "failed";
      message: string;
      details?: string;
      action?: FailureAction;
    };

export function ValidatePageView({
  groups,
  fullCheck,
  onCheckEverything,
  onStop,
  onFixEverything,
  onFixGroup,
  onRowAction,
}: ValidatePageViewProps) {
  const rows = groups.flatMap((group) => group.rows);
  const openRows = rows.filter((row) => !isDone(row));
  const fixableCount = openRows.filter((row) => row.tone === "fixable").length;
  // What "Fix everything" does: rows with a **Fix** button, and no others.
  // "Remove from set" deletes an entry, which nobody should do in bulk without
  // looking -- so it is fixable here, one row at a time, but never counted in.
  const bulkFixCount = openRows.filter(
    (row) => row.tone === "fixable" && row.action.kind === "fix",
  ).length;
  const fileCount = groups.filter((group) =>
    group.rows.some((row) => !isDone(row)),
  ).length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-fg-secondary" aria-hidden />
          <h1 className="text-lg font-medium text-fg-primary">Validate</h1>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Summary
            fullCheck={fullCheck}
            errorCount={openRows.length}
            fileCount={fileCount}
            fixableCount={fixableCount}
          />
          <div className="flex items-center gap-2">
            {fullCheck.status === "running" ? (
              <Button variant="secondary" size="sm" onClick={onStop}>
                Stop
              </Button>
            ) : fullCheck.status === "failed" ? null : ( // **Try again**; a second button doing the same thing is noise. // The banner below carries
              <Button
                variant={
                  fullCheck.status === "not-run" ? "default" : "secondary"
                }
                size="sm"
                onClick={onCheckEverything}
              >
                {fullCheck.status === "not-run"
                  ? "Check everything"
                  : fullCheck.status === "stopped"
                    ? "Check the rest"
                    : "Check again"}
              </Button>
            )}
            {bulkFixCount > 1 && fullCheck.status !== "running" && (
              <Button size="sm" onClick={onFixEverything}>
                Fix everything ({bulkFixCount})
              </Button>
            )}
          </div>
        </div>
        {fullCheck.status === "running" && <RunProgress state={fullCheck} />}
      </header>

      {fullCheck.status === "failed" && (
        <CheckFailed
          message={fullCheck.message}
          details={fullCheck.details}
          action={fullCheck.action ?? "try-again"}
          onTryAgain={onCheckEverything}
        />
      )}
      {fullCheck.status === "stopped" && (
        <Banner tone="neutral" icon={<AlertCircle size={16} aria-hidden />}>
          Stopped after {fullCheck.checked} of {fullCheck.total} files. The rest
          have not been checked, so they may still have errors.
        </Banner>
      )}
      {fullCheck.status === "done" && openRows.length === 0 && (
        <Banner tone="success" icon={<CheckCircle2 size={16} aria-hidden />}>
          Everything checks out: content, files, remote files and media
          directories. Ready to publish.
        </Banner>
      )}

      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <Group
            key={group.id}
            group={group}
            onFixGroup={() => onFixGroup(group.id)}
            onRowAction={onRowAction}
          />
        ))}
      </div>

      {fullCheck.status === "not-run" && (
        <div className="border-t border-dashed border-border-primary pt-4 text-sm text-fg-secondary">
          Files, remote files and media directories have not been checked
          against what is recorded about them. &ldquo;Check everything&rdquo;
          checks them on the server. It can take a minute.
        </div>
      )}
    </div>
  );
}

function Summary({
  fullCheck,
  errorCount,
  fileCount,
  fixableCount,
}: {
  fullCheck: FullCheckState;
  errorCount: number;
  fileCount: number;
  fixableCount: number;
}) {
  const counts =
    errorCount === 0
      ? "No errors"
      : `${errorCount} ${errorCount === 1 ? "error" : "errors"} in ${fileCount} ${
          fileCount === 1 ? "file" : "files"
        }`;
  switch (fullCheck.status) {
    case "not-run":
      return (
        <p className="text-sm text-fg-secondary">
          {counts} · from the Studio&rsquo;s own check
        </p>
      );
    case "running":
      return (
        <p className="flex items-center gap-2 text-sm text-fg-secondary">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Checking everything&hellip;
        </p>
      );
    case "done":
    case "stopped":
    case "failed":
      return (
        <div className="flex flex-col text-sm">
          <span className="text-fg-primary">
            {counts}
            {fixableCount > 0 && (
              <span className="text-fg-secondary">
                {" "}
                · {fixableCount} can be fixed here
              </span>
            )}
          </span>
          {fullCheck.status === "done" && (
            <span className="text-fg-tertiary">
              Checked everything {fullCheck.checkedAgo}
            </span>
          )}
        </div>
      );
  }
}

function RunProgress({
  state,
}: {
  state: Extract<FullCheckState, { status: "running" }>;
}) {
  const percent =
    state.total === 0 ? 0 : Math.round((state.checked / state.total) * 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-secondary">
          <div
            className="h-full rounded-full bg-bg-brand-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="text-xs text-fg-secondary tabular-nums">
          {state.checked} of {state.total} files
        </span>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {state.modules.map((module) => (
          <li key={module.title} className="flex items-center gap-2">
            {module.state === "checked" ? (
              <CheckCircle2
                size={13}
                className="text-fg-brand-primary"
                aria-hidden
              />
            ) : module.state === "checking" ? (
              <Loader2 size={13} className="animate-spin" aria-hidden />
            ) : (
              <span className="inline-block h-[13px] w-[13px]" aria-hidden />
            )}
            <span
              className={
                module.state === "waiting"
                  ? "text-fg-tertiary"
                  : "text-fg-primary"
              }
            >
              {module.title}
            </span>
            {module.state === "checking" && (
              <span className="text-fg-tertiary">checking&hellip;</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Group({
  group,
  onFixGroup,
  onRowAction,
}: {
  group: ValidateGroup;
  onFixGroup: () => void;
  onRowAction: (rowId: string, action: RowActionName) => void;
}) {
  const open = group.rows.filter((row) => !isDone(row));
  const fixable = open.filter(
    (row) => row.tone === "fixable" && row.action.kind === "fix",
  );
  return (
    <section className="overflow-hidden rounded-lg border border-border-primary bg-bg-primary">
      <header className="flex items-center gap-2 border-b border-border-primary bg-bg-secondary px-4 py-2">
        {group.remote ? (
          <Globe
            size={14}
            className="shrink-0 text-fg-secondary-alt"
            aria-hidden
          />
        ) : (
          <FileCode2
            size={14}
            className="shrink-0 text-fg-secondary-alt"
            aria-hidden
          />
        )}
        <span className="min-w-0 truncate text-sm text-fg-primary">
          {group.title}
        </span>
        {group.kind && (
          <span className="text-xs text-fg-tertiary">({group.kind})</span>
        )}
        <div className="ml-auto">
          {open.length === 0 ? (
            <CountPill tone="success">
              <CheckCircle2 size={11} aria-hidden />
              <span>Fixed</span>
            </CountPill>
          ) : (
            <CountPill tone="warning">{open.length}</CountPill>
          )}
        </div>
      </header>
      <ul className="flex flex-col">
        {group.rows.map((row, i) => (
          <Row
            key={row.id}
            row={row}
            isLast={i === group.rows.length - 1 && fixable.length < 2}
            onAction={(action) => onRowAction(row.id, action)}
          />
        ))}
      </ul>
      {fixable.length > 1 && (
        <div className="flex justify-end border-t border-border-secondary px-4 py-2">
          <Button variant="secondary" size="xs" onClick={onFixGroup}>
            Fix all in this file ({fixable.length})
          </Button>
        </div>
      )}
    </section>
  );
}

function Row({
  row,
  isLast,
  onAction,
}: {
  row: ValidateRow;
  isLast: boolean;
  onAction: (action: RowActionName) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const fixed = isDone(row);
  return (
    <li
      className={classNames("flex flex-col gap-2 px-4 py-3", {
        "border-b border-border-secondary": !isLast,
        "bg-bg-secondary/40": fixed,
      })}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          {fixed ? (
            <CheckCircle2
              size={15}
              className="text-fg-brand-primary"
              aria-hidden
            />
          ) : row.tone === "fixable" ? (
            <TriangleAlert
              size={15}
              className="text-fg-warning-primary-alt"
              aria-label="Can be fixed here"
            />
          ) : (
            <AlertCircle
              size={15}
              className="text-fg-error-on-surface"
              aria-label="Error"
            />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="break-all font-mono text-xs text-fg-secondary">
              {row.location}
            </span>
            {row.note && (
              <span className="text-xs text-fg-tertiary">({row.note})</span>
            )}
          </div>
          <p
            className={classNames("text-sm", {
              "text-fg-primary": !fixed,
              "text-fg-tertiary line-through": fixed,
            })}
          >
            {row.message}
          </p>
          {row.action.kind === "command" && !fixed && (
            <div className="flex items-center gap-2">
              <code className="rounded bg-bg-secondary px-2 py-1 text-xs text-fg-primary">
                {row.action.command}
              </code>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onAction("copy")}
                aria-label="Copy the command"
              >
                <Copy size={13} aria-hidden />
                Copy
              </Button>
            </div>
          )}
          {row.details && (
            <div>
              <button
                type="button"
                onClick={() => setDetailsOpen((open) => !open)}
                className="flex items-center gap-1 text-xs text-fg-tertiary hover:text-fg-secondary"
                aria-expanded={detailsOpen}
              >
                {detailsOpen ? (
                  <ChevronDown size={12} aria-hidden />
                ) : (
                  <ChevronRight size={12} aria-hidden />
                )}
                Details
              </button>
              {detailsOpen && (
                <pre className="mt-1 whitespace-pre-wrap rounded bg-bg-secondary p-2 text-xs text-fg-secondary">
                  {row.details}
                </pre>
              )}
            </div>
          )}
          {row.body && <div className="pt-1">{row.body}</div>}
          <FixFeedback state={row.fixState} onAction={onAction} />
        </div>
        {!fixed && <RowButtons row={row} onAction={onAction} />}
      </div>
    </li>
  );
}

function RowButtons({
  row,
  onAction,
}: {
  row: ValidateRow;
  onAction: (action: RowActionName) => void;
}) {
  const fixing = row.fixState?.status === "fixing";
  switch (row.action.kind) {
    case "fix":
      return (
        <Button
          size="xs"
          onClick={() => onAction("fix")}
          disabled={fixing}
          className="shrink-0"
        >
          {fixing && <Loader2 size={13} className="animate-spin" aria-hidden />}
          {row.action.label ?? "Fix"}
        </Button>
      );
    case "open":
      return (
        <Button
          variant="secondary"
          size="xs"
          onClick={() => onAction("open")}
          className="shrink-0"
        >
          Open
        </Button>
      );
    case "remove-from-set":
      return (
        <Button
          variant="secondary"
          size="xs"
          onClick={() => onAction("remove-from-set")}
          disabled={fixing}
          className="shrink-0"
        >
          Remove from set
        </Button>
      );
    case "try-again-or-remove":
      return (
        <div className="flex shrink-0 gap-2">
          <Button size="xs" onClick={() => onAction("try-again")}>
            Try again
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => onAction("remove")}
          >
            Remove
          </Button>
        </div>
      );
    case "try-again":
      return (
        <Button
          variant="secondary"
          size="xs"
          onClick={() => onAction("try-again")}
          disabled={fixing}
          className="shrink-0"
        >
          {fixing && <Loader2 size={13} className="animate-spin" aria-hidden />}
          Try again
        </Button>
      );
    case "check-module":
      return (
        <Button
          variant="secondary"
          size="xs"
          onClick={() => onAction("check-module")}
          className="shrink-0"
        >
          Check this file
        </Button>
      );
    case "command":
      return null;
  }
}

function FixFeedback({
  state,
  onAction,
}: {
  state: FixState | undefined;
  onAction: (action: RowActionName) => void;
}) {
  if (!state || state.status === "fixing") {
    return null;
  }
  if (state.status === "resolved") {
    return (
      <div className="flex items-center gap-1.5 text-sm text-fg-brand-primary">
        <CheckCircle2 size={13} aria-hidden />
        <span>Fixed.</span>
      </div>
    );
  }
  if (state.status === "fixed") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-brand-primary">
        <span>Added to your changes: {state.summary}</span>
        <Button variant="link" size="xs" onClick={() => onAction("review")}>
          Review
        </Button>
        <Button variant="link" size="xs" onClick={() => onAction("undo")}>
          Undo
        </Button>
      </div>
    );
  }
  const action = state.action ?? "try-again";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-fg-error-on-surface">
      <span>{state.message}</span>
      {action === "try-again" && (
        <Button variant="link" size="xs" onClick={() => onAction("fix")}>
          Try again
        </Button>
      )}
      {action === "sign-in" && <SignIn variant="link" />}
    </div>
  );
}

/** Signs in and comes back to this page. */
function SignIn({ variant }: { variant: "link" | "default" }) {
  return (
    <Button asChild variant={variant} size="xs" className="shrink-0">
      <a
        href={urlOf("/api/val/authorize", {
          redirect_to: window.location.href,
        })}
      >
        Sign in
      </a>
    </Button>
  );
}

function CheckFailed({
  message,
  details,
  action,
  onTryAgain,
}: {
  message: string;
  details?: string;
  action: FailureAction;
  onTryAgain: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-primary bg-bg-secondary px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <AlertCircle
          size={16}
          className="mt-0.5 shrink-0 text-fg-error-on-surface"
          aria-hidden
        />
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-fg-primary">{message}</span>
          <span className="text-fg-secondary">
            What was already checked is still shown below.
          </span>
        </div>
        {action === "try-again" && (
          <Button size="xs" onClick={onTryAgain} className="shrink-0">
            Try again
          </Button>
        )}
        {action === "sign-in" && <SignIn variant="default" />}
      </div>
      {details && (
        <div className="pl-7">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1 text-xs text-fg-tertiary hover:text-fg-secondary"
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown size={12} aria-hidden />
            ) : (
              <ChevronRight size={12} aria-hidden />
            )}
            Details
          </button>
          {open && (
            <pre className="mt-1 whitespace-pre-wrap text-xs text-fg-secondary">
              {details}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "success" | "neutral";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={classNames(
        "flex items-center gap-3 rounded-lg border border-border-primary px-4 py-3 text-sm text-fg-primary",
        {
          "bg-bg-brand-primary": tone === "success",
          "bg-bg-secondary": tone === "neutral",
        },
      )}
    >
      <span className="shrink-0 text-fg-secondary">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function CountPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "warning" | "success";
}) {
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        {
          "bg-bg-warning-primary text-fg-warning-primary": tone === "warning",
          "bg-bg-brand-primary text-fg-brand-primary": tone === "success",
        },
      )}
    >
      {children}
    </span>
  );
}

/** A row that no longer needs anything: fixed here, or fixed in place. */
function isDone(row: ValidateRow): boolean {
  return (
    row.fixState?.status === "fixed" || row.fixState?.status === "resolved"
  );
}
