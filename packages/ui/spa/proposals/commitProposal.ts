import { formatRelativeTime } from "../utils/formatRelativeTime";
import {
  commitRefusalOf,
  ProposalsApiError,
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
      const theirs = refusal.pushed.theirs;
      return {
        status: "someone-pushed",
        message: refusal.message,
        branch: refusal.pushed.branch,
        branchUrl: refusal.pushed.branchUrl,
        who: theirs.author?.name ?? theirs.author?.login ?? null,
        ago:
          theirs.at !== null ? formatRelativeTime(theirs.at, Date.now()) : null,
        theirs: { sha: theirs.sha, url: theirs.url, message: theirs.message },
      };
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
