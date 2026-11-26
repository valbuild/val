import { useState } from "react";
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
  /**
   * It could not run: not the change's fault. `message` is for the person;
   * `details` is what the service said, for support.
   */
  | { status: "failed"; message: string; details?: string };

/** Whether the page check can be run again from the bar, and if not, why. */
export type PageRetry =
  | { status: "available"; run: () => void }
  /** As often as it may since the person's last message. */
  | { status: "limited" }
  /** No preview open: there is no page to read. */
  | { status: "no-preview" }
  /**
   * The change could not be on the page, and a check now would find it so
   * again: what it says is what to do (`pageCheckNotShown`).
   */
  | { status: "not-shown" };

export type ChecksBarViewProps = {
  typecheck: CheckStatus;
  lint: CheckStatus;
  page: CheckStatus;
  followUp: ChecksFollowUpState;
  /** Sends a message as the person, asking for the findings to be fixed. */
  onFixIt: () => void;
  /** Runs the page check again, or why it cannot be. */
  pageRetry: PageRetry;
  /** Runs the typecheck and lint again; `null` when that cannot help. */
  onRetryChecks: (() => void) | null;
};

export function ChecksBarView({
  typecheck,
  lint,
  page,
  followUp,
  onFixIt,
  pageRetry,
  onRetryChecks,
}: ChecksBarViewProps) {
  const anything =
    typecheck.status !== "idle" ||
    lint.status !== "idle" ||
    page.status !== "idle" ||
    followUp.status !== "idle";
  /*
   * Hidden until the checks say something else: on a phone, what they found
   * can fill the space above the composer. What they say is the four of
   * them; a re-render with the same is not something new.
   */
  const saying = JSON.stringify([typecheck, lint, page, followUp]);
  const [hidden, setHidden] = useState<string | null>(null);
  if (!anything || hidden === saying) return null;
  return (
    <div
      className="mb-2 flex max-h-[40vh] flex-col gap-2 overflow-y-auto"
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
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto h-6 w-6 p-0 touch:h-8 touch:w-8"
          aria-label="Hide the checks"
          title="Hide the checks until they find something new"
          onClick={() => setHidden(saying)}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      {(typecheck.status === "failed" || lint.status === "failed") && (
        <FailureRow
          message={
            typecheck.status === "failed" && lint.status === "failed"
              ? "The typecheck and Val's lint rules could not run."
              : typecheck.status === "failed"
                ? "The typecheck could not run."
                : "Val's lint rules could not run."
          }
          details={[typecheck, lint]
            .map((check) =>
              check.status === "failed"
                ? (check.details ?? check.message)
                : null,
            )
            .filter((line): line is string => line !== null)
            .join("\n")}
          retry={onRetryChecks}
        />
      )}
      {page.status === "failed" && (
        <FailureRow
          message={`${page.message}${
            pageRetry.status === "limited"
              ? " It runs again after your next message."
              : pageRetry.status === "no-preview"
                ? " It runs again once the preview is open."
                : ""
          }`}
          details={page.details}
          retry={pageRetry.status === "available" ? pageRetry.run : null}
        />
      )}
      {followUp.status === "stopped" && (
        <div className="flex flex-col gap-1 rounded-md border border-border-warning-primary bg-bg-warning-secondary px-3 py-2 text-xs touch:text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-warning-primary"
              aria-hidden
            />
            <span className="min-w-0 flex-1 text-fg-primary">
              {stoppedTitle(followUp)}
            </span>
            <Button size="xs" onClick={onFixIt}>
              Fix it
            </Button>
          </div>
          {/*
           * Folded: the assistant's own messages say what the checks found,
           * so the bar says it once, in a line, and keeps the list for
           * whoever wants it.
           */}
          <details className="pl-5 text-fg-secondary">
            <summary className="cursor-pointer">What they found</summary>
            <ul className="mt-1 flex flex-col gap-1 pl-4">
              {followUp.findings.flatMap(describeFinding).map((line, i) => (
                <li key={i} className="list-disc break-words">
                  {line}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

/** A check that could not run: what happened, Try again when it can help, and Details for support. */
function FailureRow({
  message,
  details,
  retry,
}: {
  message: string;
  details?: string;
  retry: (() => void) | null;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-xs touch:text-sm">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-fg-secondary">{message}</span>
        {retry !== null && (
          <Button size="xs" variant="outline" onClick={retry}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
            Try again
          </Button>
        )}
      </div>
      {details !== undefined && details !== "" && (
        <details className="text-fg-secondary">
          <summary className="cursor-pointer">Details</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words">{details}</pre>
        </details>
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
    return {
      status: "failed",
      message: state.message,
      ...(state.details !== undefined ? { details: state.details } : {}),
    };
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
  pageCheckCanRun,
  retryChecks,
}: {
  proposalName: string;
  onFixIt: () => void;
  retryPageCheck: () => void;
  /** Read as the bar renders, which it does whenever a check moves. */
  pageCheckCanRun: () => "yes" | "limited" | "no-preview";
  /** Typecheck and lint what is staged again. */
  retryChecks: () => void;
}) {
  const typecheck = useTypecheckState();
  const lint = useBackgroundLint();
  const page = usePageCheck();
  const followUp = useChecksFollowUp();
  const canRun = pageCheckCanRun();
  // Checked again, a change that could not be on the page is not on it
  // again -- unless its quick preview was only slow.
  const notShown =
    page.status === "done" &&
    page.name === proposalName &&
    page.notShown !== undefined &&
    page.notShown !== "timeout";
  const typecheckOf: CheckStatus =
    typecheck.status === "idle" || typecheck.name !== proposalName
      ? { status: "idle" }
      : typecheck.status === "running"
        ? { status: "running" }
        : typecheck.status === "failed"
          ? {
              status: "failed",
              message: "The typecheck could not run.",
              details: typecheck.message,
            }
          : typecheck.errors.length === 0
            ? { status: "ok" }
            : { status: "problems", count: typecheck.errors.length };
  // A typecheck that failed for good -- not adept or the network -- fails
  // again: no Try again for it.
  const typecheckRetryable =
    typecheck.status !== "failed" || typecheck.retryable;
  return (
    <ChecksBarView
      typecheck={typecheckOf}
      lint={
        lint.status === "idle" || lint.name !== proposalName
          ? { status: "idle" }
          : lint.status === "running"
            ? { status: "running" }
            : lint.status === "failed"
              ? {
                  status: "failed",
                  message: "Val's lint rules could not run.",
                  details: lint.message,
                }
              : lint.problems.length === 0
                ? { status: "ok" }
                : { status: "problems", count: lint.problems.length }
      }
      page={pageStatus(page, proposalName)}
      followUp={followUp}
      onFixIt={onFixIt}
      pageRetry={
        notShown
          ? { status: "not-shown" }
          : canRun === "yes"
            ? { status: "available", run: retryPageCheck }
            : { status: canRun }
      }
      onRetryChecks={typecheckRetryable ? retryChecks : null}
    />
  );
}
