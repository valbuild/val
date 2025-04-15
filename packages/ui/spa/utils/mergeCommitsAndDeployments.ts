import { ValCommit, ValDeployment } from "@valbuild/shared/internal";

/**
 * We merge Val commits (which are created by Val and immutable) and
 * deployments which basically comes from GitHub.
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
    if (!deploymentsByCommitSha[commit.commitSha]) {
      deploymentsByCommitSha[commit.commitSha] = {
        commitMessage: commit?.commitMessage || null,
        deploymentState: "created",
        creator: commit.creator,
        createdAt: commit.createdAt,
        updatedAt: commit.createdAt,
        commitSha: commit.commitSha,
      };
    }
  }
  for (const deployment of deployments) {
    // NOTE: we ignore the deployments without commit sha - this is a new property, in the future they should all have it. We can't really do much useful stuff without knowing the commit?
    if (deployment.commitSha) {
      deploymentsByCommitSha[deployment.commitSha] = {
        commitMessage:
          deploymentsByCommitSha[deployment.commitSha]?.commitMessage || null,
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
