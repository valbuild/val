import { ExternalLink, GitCommit } from "lucide-react";
import { cn } from "../designSystem/cn";

/**
 * A Commit that was refused because somebody else pushed to the proposal's
 * git branch since Val last did (content's `someone-pushed`). Pressing Commit
 * again would be refused the same way -- content does not know the other
 * push -- so there is no Try again: the notice says who pushed and when,
 * says Val will not commit over it, and links their commit, which is where a
 * developer sorts it out. Bringing their commit into the proposal comes later
 * (`docs/plans/one-content-model.md`, "Code mode", decision 4).
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
};

export function CommitRefusedNotice({
  refused,
  onDismiss,
}: {
  refused: CommitRefused;
  onDismiss: () => void;
}) {
  const who = refused.who ?? "Someone";
  const title = `${who} pushed to ${refused.branch}${refused.ago !== null ? ` ${refused.ago}` : ""}`;
  const subject = refused.commit.message?.split("\n")[0] ?? null;
  return (
    <section
      role="alert"
      aria-label={title}
      className="relative rounded-lg border border-border-error-primary bg-bg-tertiary p-4"
    >
      <div className="flex gap-3">
        <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 text-fg-error-primary">
          <GitCommit size={16} />
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
            {refused.during === "commit"
              ? "Val does not commit over a push it has not seen, so nothing was committed."
              : "Val does not commit over a push it has not seen, so nothing was committed or published."}{" "}
            Everything is still saved in the proposal. A developer can bring
            their commit into the branch, or move it elsewhere; then commit
            again.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={refused.commit.url}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
                "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
              )}
            >
              <ExternalLink size={12} /> Open their commit
            </a>
            <button
              type="button"
              onClick={onDismiss}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
                "border border-border-primary text-fg-primary hover:bg-bg-float-raised",
              )}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
