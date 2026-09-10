import { ValCommit, ValDeployment } from "@valbuild/shared/internal";

/**
 * We merge Val commits (which are created by Val and immutable) and
 * deployments which basically comes from GitHub.
 *
 * A deployment can arrive with no Val commit behind it at all — a developer's
 * push, a merged pull request, a revert — and those are the majority on most
 * projects. Their message therefore has to come off the deployment itself; see
 * `ValDeployment.commitMessage`. Val's own commit wins where there is one: it
 * is the message Val wrote, and it is known before any host has reported a
 * build.
 */
export type ValEnrichedDeployment = {
  deploymentState: "pending" | "success" | "failure" | "error" | "created";
  commitMessage: string | null;
  creator: string | null;
  commitSha: string;
  createdAt: string;
  updatedAt: string;
};

export function mergeCommitsAndDeployments(
  prev: ValEnrichedDeployment[],
  commits: ValCommit[],
  deployments: ValDeployment[],
): ValEnrichedDeployment[] {
  const deploymentsByCommitSha: Record<string, ValEnrichedDeployment> = {};

  for (const deployment of prev) {
    deploymentsByCommitSha[deployment.commitSha] = deployment;
  }
  for (const commit of commits) {
    // Assumes commits (of a given commit sha) are immutable so if we already found something for this commit sha, we don't need to add it again
    const existing = deploymentsByCommitSha[commit.commitSha];
    if (!existing) {
      deploymentsByCommitSha[commit.commitSha] = {
        commitMessage: commit?.commitMessage || null,
        deploymentState: "created",
        creator: commit.creator,
        createdAt: commit.createdAt,
        updatedAt: commit.createdAt,
        commitSha: commit.commitSha,
      };
      continue;
    }
    /**
     * Something is already here, and it came from the HOST: the same commit
     * seen from the deployment side, which can arrive first - the socket
     * delivers whatever happens first, and a build often starts before this
     * client has fetched the commit that triggered it.
     *
     * Its build state and its timestamps are the host's to report and are left
     * alone. The message and the author are not: this is the commit Val wrote,
     * so they win here - which is the precedence claimed above and everywhere
     * else in this file. Skipping the row outright, as this used to, left a
     * publish of Val's own named by whatever the host had said about the
     * commit, for the whole life of the tab.
     */
    deploymentsByCommitSha[commit.commitSha] = {
      ...existing,
      commitMessage: commit.commitMessage || existing.commitMessage,
      creator: commit.creator || existing.creator,
    };
  }
  /**
   * Oldest first, so the newest state for a commit is the one that survives.
   *
   * The fold below overwrites whatever it already has for a commit sha, so the
   * LAST entry wins — and the two sources disagree about order. The socket
   * appends, so there the newest is last; `/stat` returns the content service's
   * rows ordered by `updated_at DESC`, so there the newest is FIRST and a
   * finished deployment was being overwritten by the pending one it replaced.
   */
  const orderedDeployments = [...deployments].sort(
    (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
  );
  for (const deployment of orderedDeployments) {
    // NOTE: we ignore the deployments without commit sha - this is a new property, in the future they should all have it. We can't really do much useful stuff without knowing the commit?
    if (deployment.commitSha) {
      deploymentsByCommitSha[deployment.commitSha] = {
        // What we already know first — a Val commit's own message, or a message
        // an earlier row for this sha carried — then the host's. A commit sha
        // is immutable, so these cannot be messages for different things.
        commitMessage:
          deploymentsByCommitSha[deployment.commitSha]?.commitMessage ||
          deployment.commitMessage ||
          null,
        deploymentState:
          deployment.deploymentState as ValEnrichedDeployment["deploymentState"],
        creator: deploymentsByCommitSha[deployment.commitSha]?.creator || null,
        createdAt:
          deploymentsByCommitSha[deployment.commitSha]?.createdAt ||
          deployment.createdAt,
        updatedAt: deployment.updatedAt,
        commitSha: deployment.commitSha,
      };
    }
  }

  return Object.values(deploymentsByCommitSha).sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

/**
 * The first line of a commit message, which is the whole of what a row shows.
 *
 * Val writes single-line messages, so this did nothing until deployments Val
 * did NOT publish started arriving with their own messages — a push, a merged
 * pull request — and a git message is a subject, a blank line and a body. The
 * rows truncate, so the body was rendered as one long line with the subject
 * lost somewhere at the front of it.
 *
 * A message that is only whitespace is no message: `null`, which is what makes
 * the row fall back to the short sha rather than showing an empty title.
 */
export function commitSubject(message: string | null): string | null {
  if (message === null) return null;
  const subject = message.split("\n", 1)[0].trim();
  return subject === "" ? null : subject;
}
