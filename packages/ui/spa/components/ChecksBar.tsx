import { AlertTriangle, Check, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "./designSystem/button";
import { cn } from "./designSystem/cn";
import { useTypecheckState } from "../proposals/useProposalTypecheck";
import { useBackgroundLint } from "../proposals/backgroundLint";
import { usePageCheck, type PageCheckState } from "../proposals/pageCheck";
import {
  useChecksFollowUp,
  type CheckFinding,
  type ChecksFollowUpState,
} from "../proposals/checksFollowUp";

/**
 * The checks that run beside the chat in code mode, above the composer: the
 * typecheck, Val's lint rules and the page check, each in a word; the
 * assistant fixing what they found; and, when the follow-ups stop, what is
 * still wrong with a way to have it fixed.
 *
 * The person is never waiting on any of this: it is here so they can see the
 * change is being checked, and so nothing a check found is lost.
 */
export type CheckStatus =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok" }
  | { status: "problems"; count: number }
  /** It could not run: not the change's fault. */
  | { status: "failed"; message: string };

export type ChecksBarViewProps = {
  typecheck: CheckStatus;
  lint: CheckStatus;
  page: CheckStatus;
  followUp: ChecksFollowUpState;
  /** Sends a message as the person, asking for the findings to be fixed. */
  onFixIt: () => void;
  /** Runs the page check again; `null` when none is left until the person writes. */
  onRetryPageCheck: (() => void) | null;
};

export function ChecksBarView({
  typecheck,
  lint,
  page,
  followUp,
  onFixIt,
  onRetryPageCheck,
}: ChecksBarViewProps) {
  const anything =
    typecheck.status !== "idle" ||
    lint.status !== "idle" ||
    page.status !== "idle" ||
    followUp.status !== "idle";
  if (!anything) return null;
  return (
    <div
      className="mb-2 flex flex-col gap-2"
      role="status"
      aria-label="Checks of the change"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs touch:text-sm text-fg-secondary">
        <span>Checks</span>
        <CheckChip label="Types" check={typecheck} problems="errors" />
        <CheckChip label="Lint" check={lint} problems="problems" />
        <CheckChip label="Page" check={page} problems="problems" />
        {followUp.status === "fixing" && (
          <span className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Fixing what they found ({followUp.attempt} of {followUp.of})
          </span>
        )}
      </div>
      {page.status === "failed" && (
        <div className="flex items-start gap-2 rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-xs touch:text-sm">
          <span className="min-w-0 flex-1 text-fg-secondary">
            The page check could not finish: {page.message}{" "}
            {onRetryPageCheck === null &&
              "It runs again after your next message."}
          </span>
          {onRetryPageCheck !== null && (
            <Button size="xs" variant="outline" onClick={onRetryPageCheck}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
              Try again
            </Button>
          )}
        </div>
      )}
      {followUp.status === "stopped" && (
        <div className="flex flex-col gap-2 rounded-md border border-border-warning-primary bg-bg-warning-secondary px-3 py-2 text-xs touch:text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-warning-primary"
              aria-hidden
            />
            <span className="min-w-0 flex-1 text-fg-primary">
              {stoppedTitle(followUp)}
            </span>
          </div>
          <ul className="flex flex-col gap-1 pl-5 text-fg-secondary">
            {followUp.findings.flatMap(describeFinding).map((line, i) => (
              <li key={i} className="list-disc break-words">
                {line}
              </li>
            ))}
          </ul>
          <div>
            <Button size="xs" onClick={onFixIt}>
              Fix it
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckChip({
  label,
  check,
  problems,
}: {
  label: string;
  check: CheckStatus;
  problems: string;
}) {
  if (check.status === "idle") return null;
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full border px-2 py-0.5",
        check.status === "problems"
          ? "border-border-warning-primary text-fg-warning-primary"
          : "border-border-primary",
      )}
    >
      {check.status === "running" && (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      )}
      {check.status === "ok" && <Check className="h-3 w-3" aria-hidden />}
      {check.status === "problems" && (
        <AlertTriangle className="h-3 w-3" aria-hidden />
      )}
      {check.status === "failed" && <X className="h-3 w-3" aria-hidden />}
      {label}
      {check.status === "problems" && (
        <span>
          {check.count} {problems}
        </span>
      )}
      {check.status === "failed" && <span>did not run</span>}
    </span>
  );
}

function stoppedTitle(
  stopped: Extract<ChecksFollowUpState, { status: "stopped" }>,
): string {
  if (stopped.reason === "no-progress") {
    return "The assistant's last fix did not change what the checks find.";
  }
  if (stopped.attempts === 0) {
    return "The checks found problems in the last change.";
  }
  return `The checks still find problems after ${stopped.attempts} automatic ${
    stopped.attempts === 1 ? "fix" : "fixes"
  }.`;
}

/** A finding, in a line or a few, for the person. */
export function describeFinding(finding: CheckFinding): string[] {
  const value: unknown = finding.value;
  const field = (key: string): unknown =>
    typeof value === "object" && value !== null
      ? Reflect.get(value, key)
      : undefined;
  const listOf = (key: string): unknown[] => {
    const list = field(key);
    return Array.isArray(list) ? list : [];
  };
  const text = (item: unknown, key: string): string | null => {
    if (typeof item !== "object" || item === null) return null;
    const got: unknown = Reflect.get(item, key);
    return typeof got === "string" || typeof got === "number"
      ? String(got)
      : null;
  };
  switch (finding.key) {
    case "typecheck_errors": {
      const errors = listOf("errors");
      return [
        `${errors.length} type ${errors.length === 1 ? "error" : "errors"}`,
        ...errors
          .slice(0, 3)
          .map(
            (error) =>
              `${text(error, "file") ?? "?"}:${text(error, "line") ?? "?"} ${text(error, "message") ?? ""}`,
          ),
      ];
    }
    case "lint_problems": {
      const problems = listOf("problems");
      return [
        `${problems.length} lint ${problems.length === 1 ? "problem" : "problems"}`,
        ...problems
          .slice(0, 3)
          .map(
            (problem) =>
              `${text(problem, "path") ?? "?"}:${text(problem, "line") ?? "?"} ${text(problem, "message") ?? ""}`,
          ),
      ];
    }
    case "page_check": {
      const summary = field("summary");
      return [
        typeof summary === "string" ? `On the page: ${summary}` : "On the page",
        ...listOf("findings")
          .slice(0, 3)
          .map((item) => {
            const where = text(item, "where");
            return `${text(item, "message") ?? ""}${where !== null ? ` (${where})` : ""}`;
          }),
      ];
    }
    case "valModules":
      return [
        "The site's content code does not run, or content no longer fits its schema.",
      ];
    default:
      return [finding.key];
  }
}

/** The page check, as a chip. */
function pageStatus(state: PageCheckState, name: string): CheckStatus {
  if (state.status === "idle" || state.name !== name) return { status: "idle" };
  if (state.status === "running") return { status: "running" };
  if (state.status === "failed") {
    return { status: "failed", message: state.message };
  }
  if (state.report.status === "pass") return { status: "ok" };
  if (state.report.status === "blocked") {
    return { status: "failed", message: state.report.summary };
  }
  return {
    status: "problems",
    count: Math.max(1, state.report.findings.length),
  };
}

/** The text "Fix it" sends as the person: the findings go with it. */
export const FIX_IT_MESSAGE = "Fix what the checks found in the last change.";

/** `ChecksBarView`, with the checks of proposal `name` as they are. */
export function ChecksBar({
  proposalName,
  onFixIt,
  retryPageCheck,
  pageChecksLeft,
}: {
  proposalName: string;
  onFixIt: () => void;
  retryPageCheck: () => void;
  /** Read as the bar renders, which it does whenever a check moves. */
  pageChecksLeft: () => number;
}) {
  const typecheck = useTypecheckState();
  const lint = useBackgroundLint();
  const page = usePageCheck();
  const followUp = useChecksFollowUp();
  return (
    <ChecksBarView
      typecheck={
        typecheck.status === "idle" || typecheck.name !== proposalName
          ? { status: "idle" }
          : typecheck.status === "running"
            ? { status: "running" }
            : typecheck.status === "failed"
              ? { status: "failed", message: typecheck.message }
              : typecheck.errors.length === 0
                ? { status: "ok" }
                : { status: "problems", count: typecheck.errors.length }
      }
      lint={
        lint.status === "idle" || lint.name !== proposalName
          ? { status: "idle" }
          : lint.status === "running"
            ? { status: "running" }
            : lint.status === "failed"
              ? { status: "failed", message: lint.message }
              : lint.problems.length === 0
                ? { status: "ok" }
                : { status: "problems", count: lint.problems.length }
      }
      page={pageStatus(page, proposalName)}
      followUp={followUp}
      onFixIt={onFixIt}
      onRetryPageCheck={pageChecksLeft() > 0 ? retryPageCheck : null}
    />
  );
}
