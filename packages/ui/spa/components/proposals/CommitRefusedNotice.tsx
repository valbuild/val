import {
  AlertTriangle,
  Check,
  ExternalLink,
  GitCommit,
  GitMerge,
  Hammer,
  Loader2,
  LogIn,
  RotateCcw,
  Upload,
} from "lucide-react";
import { cn } from "../designSystem/cn";

/**
 * A Commit -- or the commit Publish makes before it merges -- refused because
 * somebody else pushed to the proposal's git branch since Val last did
 * (content's `someone-pushed`). Pressing Commit again would be refused the
 * same way, since content has not seen their push, so there is no Try again:
 * the notice says who pushed and when, links their commit, and offers
 * **Build on their push**, which brings their changes into the proposal and
 * makes their commit the one Val commits on top of. Then Commit (or Publish)
 * goes through.
 */
export type CommitRefused = {
  /** `val/p/<name>`. */
  branch: string;
  branchUrl: string;
  /** Who pushed: a name, a GitHub login, or `null` when GitHub would not say. */
  who: string | null;
  /** "5 minutes ago", or `null` when not known. */
  ago: string | null;
  commit: { sha: string; url: string; message: string | null };
  /** Commit, or the commit Publish makes before it merges. */
  during: "commit" | "publish";
  /**
   * Their push moved again while this notice was up: `commit` is the newer
   * one, and Build on their push brings that in.
   */
  movedAgain?: boolean;
};

/** Building on their push: where it is. */
export type BuildOnPushState =
  | { kind: "idle" }
  | { kind: "building" }
  /**
   * Their changes are in the proposal. `kept`: files both they and the
   * proposal changed, where the proposal's version was kept. `notTaken`:
   * what a proposal cannot hold, which the next Commit leaves as the site
   * has it.
   */
  | {
      kind: "built";
      kept: string[];
      notTaken: string[];
      rewritten: boolean;
      rebuild: RebuildState;
    }
  | {
      kind: "failed";
      message: string;
      /**
       * What helps, and only what does: press it again (the proposal or
       * GitHub was busy), sign in again, the organization's Billing (the
       * plan refuses writes), or -- with nothing left to bring in -- Commit
       * or Publish again. `null`: nothing here can help, and the
       * message says what can.
       */
      offer: BuildOnPushOffer | null;
    };

/**
 * The proposal's preview, rebuilt with their code: Publish waits for it
 * (content's `taken-push` merge check); Commit does not.
 */
export type RebuildState =
  /** Nothing to build: no text came in, or it is built. */
  | { state: "done" }
  | { state: "running" }
  /** Not started: the tab it is built in has to be opened, or Build pressed. */
  | { state: "due" }
  | { state: "failed"; message: string; canRetry: boolean };

export type BuildOnPushOffer =
  | { kind: "retry" }
  /** Signing in comes back to `url`'s `redirect_to`: this page. */
  | { kind: "sign-in"; url: string }
  /** The project's plan refuses writes: the organization's Billing. */
  | { kind: "billing"; url: string }
  | { kind: "again" };

export function CommitRefusedNotice({
  refused,
  state = { kind: "idle" },
  onBuildOn,
  onAgain,
  onRebuild,
  onDismiss,
}: {
  refused: CommitRefused;
  state?: BuildOnPushState;
  /** Build on their push. */
  onBuildOn: () => void;
  /** Commit again, or Publish again: after their push is in. */
  onAgain: () => void;
  /** Build the proposal's preview with their code: due, or failed. */
  onRebuild?: () => void;
  onDismiss: () => void;
}) {
  const who = refused.who ?? "Someone";
  const verb = refused.movedAgain === true ? "pushed again to" : "pushed to";
  const title =
    state.kind === "built"
      ? `${who}'s push is in the proposal`
      : `${who} ${verb} ${refused.branch}${refused.ago !== null ? ` ${refused.ago}` : ""}`;
  const subject = refused.commit.message?.split("\n")[0] ?? null;
  const again = refused.during === "commit" ? "Commit" : "Publish";
  const good = state.kind === "built" || state.kind === "building";
  const Icon =
    state.kind === "building"
      ? Loader2
      : state.kind === "built"
        ? Check
        : state.kind === "failed"
          ? AlertTriangle
          : GitCommit;
  /* Publish waits for the preview to have their code; Commit does not. */
  const rebuild = state.kind === "built" ? state.rebuild : null;
  const againWaits =
    refused.during === "publish" &&
    rebuild !== null &&
    rebuild.state !== "done";
  return (
    <section
      role={
        state.kind === "idle" || state.kind === "failed" ? "alert" : "status"
      }
      aria-label={title}
      className={cn(
        "relative rounded-lg border bg-bg-tertiary p-4",
        good ? "border-border-proposal" : "border-border-error-primary",
      )}
    >
      <div className="flex gap-3">
        {/* The span spins, not the SVG: see designSystem/spinner. */}
        <span
          className={cn(
            "mt-0.5 inline-flex h-4 w-4 shrink-0",
            good ? "text-fg-proposal" : "text-fg-error-primary",
            state.kind === "building" && "animate-spin will-change-transform",
          )}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-primary">{title}</p>
          <p className="mt-1 text-xs text-fg-secondary">
            {subject !== null && (
              <>
                <span className="font-mono text-fg-primary">
                  {refused.commit.sha.slice(0, 7)}
                </span>{" "}
                {subject}
                <br />
              </>
            )}
            {state.kind === "idle" &&
              (refused.during === "commit"
                ? "Val does not commit over a push it has not seen, so nothing was committed. "
                : "Val does not commit over a push it has not seen, so nothing was committed or published. ")}
            {state.kind === "idle" &&
              "Everything is still saved in the proposal. Build on their push to bring their changes into it, then commit on top of them."}
            {state.kind === "building" &&
              "Bringing their changes into the proposal…"}
            {state.kind === "built" &&
              `Their changes are in the proposal, and the next ${again} goes on top of their commit.`}
            {state.kind === "built" && state.rewritten && (
              <>
                {" "}
                Their push rewrote the branch's history; everything their commit
                holds was brought in.
              </>
            )}
            {state.kind === "failed" && state.message}
          </p>
          {state.kind === "built" && state.kept.length > 0 && (
            <FileList
              heading={
                state.kept.length === 1
                  ? "You both changed this file. The proposal's version was kept:"
                  : "You both changed these files. The proposal's version of each was kept:"
              }
              files={state.kept}
            />
          )}
          {state.kind === "built" && state.notTaken.length > 0 && (
            <FileList
              heading={`A proposal cannot hold ${state.notTaken.length === 1 ? "this change" : "these changes"} of theirs, so the next ${again} leaves ${state.notTaken.length === 1 ? "it" : "them"} as the site has ${state.notTaken.length === 1 ? "it" : "them"}:`}
              files={state.notTaken}
            />
          )}
          {rebuild !== null && rebuild.state !== "done" && (
            <p
              className={cn(
                "mt-2 flex items-center gap-1.5 text-xs",
                rebuild.state === "failed"
                  ? "text-fg-error-on-surface"
                  : "text-fg-secondary",
              )}
            >
              {rebuild.state === "running" && (
                <span className="inline-flex h-3 w-3 animate-spin will-change-transform">
                  <Loader2 size={12} />
                </span>
              )}
              {rebuild.state === "running"
                ? `Rebuilding the preview with their code…${againWaits ? " Publish waits for it." : ""}`
                : rebuild.state === "due"
                  ? `The preview does not have their code yet.${againWaits ? " Publish waits for it." : ""}`
                  : `The preview could not be rebuilt with their code: ${rebuild.message}`}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {state.kind === "idle" && (
              <button type="button" onClick={onBuildOn} className={PRIMARY}>
                <GitMerge size={12} /> Build on their push
              </button>
            )}
            {rebuild !== null &&
              onRebuild !== undefined &&
              (rebuild.state === "due" ||
                (rebuild.state === "failed" && rebuild.canRetry)) && (
                <button
                  type="button"
                  onClick={onRebuild}
                  className={againWaits ? PRIMARY : SECONDARY}
                >
                  <Hammer size={12} />{" "}
                  {rebuild.state === "failed" ? "Build again" : "Build"}
                </button>
              )}
            {((state.kind === "built" && !againWaits) ||
              (state.kind === "failed" && state.offer?.kind === "again")) && (
              <button type="button" onClick={onAgain} className={PRIMARY}>
                {refused.during === "commit" ? (
                  <GitCommit size={12} />
                ) : (
                  <Upload size={12} />
                )}{" "}
                {again} again
              </button>
            )}
            {state.kind === "failed" && state.offer?.kind === "retry" && (
              <button type="button" onClick={onBuildOn} className={PRIMARY}>
                <RotateCcw size={12} /> Try again
              </button>
            )}
            {state.kind === "failed" && state.offer?.kind === "sign-in" && (
              <a href={state.offer.url} className={PRIMARY}>
                <LogIn size={12} /> Sign in
              </a>
            )}
            {state.kind === "failed" && state.offer?.kind === "billing" && (
              <a
                href={state.offer.url}
                target="_blank"
                rel="noreferrer"
                className={PRIMARY}
              >
                <ExternalLink size={12} /> Open Billing
              </a>
            )}
            <a
              href={refused.commit.url}
              target="_blank"
              rel="noreferrer"
              className={SECONDARY}
            >
              <ExternalLink size={12} /> Open their commit
            </a>
            {state.kind !== "building" && (
              <button type="button" onClick={onDismiss} className={SECONDARY}>
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function FileList({ heading, files }: { heading: string; files: string[] }) {
  return (
    <div className="mt-2 text-xs text-fg-secondary">
      <p>{heading}</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {files.map((file) => (
          <li key={file} className="truncate font-mono text-fg-primary">
            {file}
          </li>
        ))}
      </ul>
    </div>
  );
}

const PRIMARY = cn(
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
  "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
);
const SECONDARY = cn(
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
  "border border-border-primary text-fg-primary hover:bg-bg-float-raised",
);
