import {
  mergeCommitsAndDeployments,
  ValEnrichedDeployment,
} from "./mergeCommitsAndDeployments";
import { ValCommit, ValDeployment } from "@valbuild/shared/internal";

describe("mergeCommitsAndDeployments", () => {
  it("should merge previous deployments, commits, and new deployments correctly", () => {
    const prev: ValEnrichedDeployment[] = [
      {
        deploymentState: "success",
        commitMessage: "Initial commit",
        creator: "user1",
        commitSha: "abc123",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T01:00:00Z",
      },
    ];

    const commits: ValCommit[] = [
      {
        commitSha: "def456",
        clientCommitSha: "client-def456",
        parentCommitSha: "parent-def123",
        branch: "feature/new-feature",
        commitMessage: "Add new feature",
        creator: "user2",
        createdAt: "2023-01-02T00:00:00Z",
      },
    ];

    const deployments: ValDeployment[] = [
      {
        commitSha: "abc123",
        deploymentState: "failure",
        updatedAt: "2023-01-01T02:00:00Z",
        createdAt: "2023-01-01T00:00:00Z",
        deploymentId: "deployment-abc123",
      },
      {
        commitSha: "ghi789",
        deploymentState: "pending",
        updatedAt: "2023-01-03T00:00:00Z",
        createdAt: "2023-01-02T00:00:00Z",
        deploymentId: "deployment-ghi789",
      },
    ];

    const result = mergeCommitsAndDeployments(prev, commits, deployments);

    expect(result).toEqual([
      {
        commitMessage: null,
        deploymentState: "pending",
        creator: null,
        createdAt: "2023-01-02T00:00:00Z",
        updatedAt: "2023-01-03T00:00:00Z",
        commitSha: "ghi789",
      },
      {
        commitMessage: "Add new feature",
        deploymentState: "created",
        creator: "user2",
        createdAt: "2023-01-02T00:00:00Z",
        updatedAt: "2023-01-02T00:00:00Z",
        commitSha: "def456",
      },
      {
        commitMessage: "Initial commit",
        deploymentState: "failure",
        creator: "user1",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T02:00:00Z",
        commitSha: "abc123",
      },
    ]);
  });

  it("should handle empty inputs", () => {
    const result = mergeCommitsAndDeployments([], [], []);
    expect(result).toEqual([]);
  });

  it("should merge deployments with commits", () => {
    const prev: ValEnrichedDeployment[] = [];
    const commits: ValCommit[] = [
      {
        commitSha: "abc123",
        clientCommitSha: "client-abc123",
        parentCommitSha: "parent-abc123",
        branch: "main",
        commitMessage: "Commit message",
        creator: "user1",
        createdAt: "2023-01-01T00:00:00Z",
      },
    ];
    const deployments: ValDeployment[] = [
      {
        commitSha: "abc123",
        deploymentState: "success",
        updatedAt: "2023-01-01T01:00:00Z",
        createdAt: "2023-01-01T00:00:00Z",
        deploymentId: "deployment-abc123",
      },
    ];

    const result = mergeCommitsAndDeployments(prev, commits, deployments);

    expect(result).toEqual([
      {
        deploymentState: "success",
        commitMessage: "Commit message",
        creator: "user1",
        commitSha: "abc123",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T01:00:00Z",
      },
    ]);
  });

  it("should ignore deployments without commitSha", () => {
    const prev: ValEnrichedDeployment[] = [];
    const commits: ValCommit[] = [];
    const deployments: ValDeployment[] = [
      {
        commitSha: "",
        deploymentState: "pending",
        updatedAt: "2023-01-01T00:00:00Z",
        createdAt: "2023-01-01T00:00:00Z",
        deploymentId: "deployment-unknown",
      },
    ];

    const result = mergeCommitsAndDeployments(prev, commits, deployments);

    expect(result).toEqual([]);
  });

  it("should sort the results by updatedAt in descending order", () => {
    const prev: ValEnrichedDeployment[] = [];
    const commits: ValCommit[] = [
      {
        commitSha: "abc123",
        clientCommitSha: "client-abc123",
        parentCommitSha: "parent-abc123",
        branch: "main",
        commitMessage: "First commit",
        creator: "user1",
        createdAt: "2023-01-01T00:00:00Z",
      },
      {
        commitSha: "def456",
        clientCommitSha: "client-def456",
        parentCommitSha: "parent-def456",
        branch: "feature/second-feature",
        commitMessage: "Second commit",
        creator: "user2",
        createdAt: "2023-01-02T00:00:00Z",
      },
    ];
    const deployments: ValDeployment[] = [];

    const result = mergeCommitsAndDeployments(prev, commits, deployments);

    expect(result).toEqual([
      {
        deploymentState: "created",
        commitMessage: "Second commit",
        creator: "user2",
        commitSha: "def456",
        createdAt: "2023-01-02T00:00:00Z",
        updatedAt: "2023-01-02T00:00:00Z",
      },
      {
        deploymentState: "created",
        commitMessage: "First commit",
        creator: "user1",
        commitSha: "abc123",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      },
    ]);
  });
});
