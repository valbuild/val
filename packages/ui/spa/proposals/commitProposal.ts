import { formatRelativeTime } from "../utils/formatRelativeTime";
import {
  commitRefusalOf,
  ProposalsApiError,
  type ProposalSomeonePushed,
  type ProposalsClient,
} from "./proposalsClient";

/**
 * Commit, in a project connected to git: the proposal as it was last saved,
 * as one commit on its branch (valbuild/home's code-mode contract, section
 * 3). What the Studio's Commit does after it has saved, and what a scenario
 * presses, so both go through one function.
 */
export type CommitOutcome =
  | {
      status: "committed";
      /** The commit now at the tip of the branch. */
      url: string;
      branch: string | null;
      /** `false`: nothing was saved since the last Commit; nothing was pushed. */
      pushed: boolean;
    }
  | {
      /**
       * Somebody else pushed to the branch since Val last did, and Val does
       * not commit over it. Pressing again would be refused the same way.
       */
      status: "someone-pushed";
      message: string;
      branch: string;
      branchUrl: string;
      /** Who pushed: a name, a GitHub login, or `null`. */
      who: string | null;
      /** "5 minutes ago", or `null`. */
      ago: string | null;
      theirs: { sha: string; url: string; message: string | null };
    }
  | {
      status: "failed";
      message: string;
      /** Whether pressing again can help: the push was busy, or GitHub was. */
      canRetry: boolean;
      /** Where to see why, when GitHub refused it for good. */
      branchUrl: string | null;
    };

export async function commitProposal(
  client: Pick<ProposalsClient, "commit">,
  name: string,
  message: string,
): Promise<CommitOutcome> {
  try {
    const answer = await client.commit(name, { message });
    return {
      status: "committed",
      url: answer.commit.url,
      branch: answer.proposal.git?.branch ?? null,
      pushed: answer.commit.pushed,
    };
  } catch (error) {
    const refusal = commitRefusalOf(error);
    const text = error instanceof Error ? error.message : String(error);
    if (refusal === null) {
      return {
        status: "failed",
        message: text,
        // No answer can be asked for again; a refusal of another kind cannot.
        canRetry: !(error instanceof ProposalsApiError),
        branchUrl: null,
      };
    }
    if (refusal.kind === "someone-pushed") {
      return someonePushedOf(refusal.message, refusal.pushed);
    }
    return {
      status: "failed",
      message: refusal.message,
      canRetry:
        refusal.kind === "committing" || refusal.kind === "github-unavailable",
      branchUrl:
        refusal.kind === "repository-refused" ? refusal.branchUrl : null,
    };
  }
}

/** Content's `someone-pushed`, as Commit and Publish both say it. */
export function someonePushedOf(
  message: string,
  pushed: ProposalSomeonePushed,
): Extract<CommitOutcome, { status: "someone-pushed" }> {
  const theirs = pushed.theirs;
  return {
    status: "someone-pushed",
    message,
    branch: pushed.branch,
    branchUrl: pushed.branchUrl,
    who: theirs.author?.name ?? theirs.author?.login ?? null,
    ago: theirs.at !== null ? formatRelativeTime(theirs.at, Date.now()) : null,
    theirs: { sha: theirs.sha, url: theirs.url, message: theirs.message },
  };
}

/**
 * Why a press of Publish was refused, when it was the commit Publish makes
 * first (`commitRefusalOf`): someone pushed, or a refusal whose Try again
 * can or cannot help. `null`: not a refused commit; the press's own message
 * says it.
 */
export function publishCommitRefusalOf(
  cause: unknown,
): Exclude<CommitOutcome, { status: "committed" }> | null {
  const refusal = commitRefusalOf(cause);
  if (refusal === null) return null;
  if (refusal.kind === "someone-pushed") {
    return someonePushedOf(refusal.message, refusal.pushed);
  }
  if (
    refusal.kind === "repository-refused" ||
    refusal.kind === "committing" ||
    refusal.kind === "github-unavailable"
  ) {
    return {
      status: "failed",
      message: refusal.message,
      canRetry: refusal.kind !== "repository-refused",
      branchUrl: refusal.branchUrl,
    };
  }
  return null;
}
