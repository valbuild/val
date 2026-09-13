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

  /**
   * The same commit, deployed twice, reported newest first.
   *
   * `/stat` returns the content service's deployment rows ordered by
   * `updated_at DESC`, and the fold keeps whichever entry it sees LAST — so a
   * commit that had gone green was being overwritten by the `pending` row that
   * preceded it, and the feed showed a finished publish as still building.
   */
  it("keeps the newest state when a commit has several deployments", () => {
    const commits: ValCommit[] = [
      {
        commitSha: "abc123",
        clientCommitSha: "client-abc123",
        parentCommitSha: "parent-abc123",
        branch: "main",
        commitMessage: "A change",
        creator: "user1",
        createdAt: "2023-01-01T00:00:00Z",
      },
    ];
    const newestFirst: ValDeployment[] = [
      {
        commitSha: "abc123",
        deploymentState: "success",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:05:00Z",
        deploymentId: "deployment-abc123",
      },
      {
        commitSha: "abc123",
        deploymentState: "pending",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:01:00Z",
        deploymentId: "deployment-abc123",
      },
    ];

    expect(
      mergeCommitsAndDeployments([], commits, newestFirst)[0].deploymentState,
    ).toBe("success");
    // And the other order, which is how the same two arrive on the socket.
    expect(
      mergeCommitsAndDeployments([], commits, [...newestFirst].reverse())[0]
        .deploymentState,
    ).toBe("success");
  });

  /**
   * A deployment nobody published from Val: a developer's push, a merged pull
   * request, a revert. There is no `ValCommit` for it, so the git message can
   * only come off the deployment - and without it the feed could name the
   * publish by nothing but its short sha.
   */
  it("takes the git message off a deployment that has no Val commit", () => {
    const result = mergeCommitsAndDeployments(
      [],
      [],
      [
        {
          commitSha: "abc123",
          deploymentId: "deployment-abc123",
          deploymentState: "success",
          commitMessage: "Bump the dependency",
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
        },
      ],
    );
    expect(result[0].commitMessage).toBe("Bump the dependency");
  });

  it("prefers Val's own commit message over the host's", () => {
    // Val wrote that one, and it is known before any build is reported. The
    // two describe the same immutable commit either way.
    const result = mergeCommitsAndDeployments(
      [],
      [
        {
          commitSha: "abc123",
          clientCommitSha: "client-abc123",
          parentCommitSha: "parent-abc123",
          branch: "main",
          commitMessage: "Update hero copy",
          creator: "user1",
          createdAt: "2023-01-01T00:00:00Z",
        },
      ],
      [
        {
          commitSha: "abc123",
          deploymentId: "deployment-abc123",
          deploymentState: "success",
          commitMessage: "val: update hero copy [skip ci]",
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
        },
      ],
    );
    expect(result[0].commitMessage).toBe("Update hero copy");
  });

  it("survives a content service that reports no messages at all", () => {
    // The field is optional as well as nullable: absent is an older service,
    // null is one that has no message for this commit. Both are the short sha.
    const result = mergeCommitsAndDeployments(
      [],
      [],
      [
        {
          commitSha: "abc123",
          deploymentId: "deployment-abc123",
          deploymentState: "pending",
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
        },
        {
          commitSha: "def456",
          deploymentId: "deployment-def456",
          deploymentState: "pending",
          commitMessage: null,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T00:30:00Z",
        },
      ],
    );
    expect(result.map((d) => d.commitMessage)).toEqual([null, null]);
  });

  /**
   * The deployment side of a commit can arrive FIRST - the socket delivers
   * whatever happens first, and a build often starts before this client has
   * fetched the commit that triggered it. The row is then already there when
   * Val's own commit turns up, and skipping it outright (which is what this
   * loop used to do) left a publish of Val's own named by whatever the host
   * had said about the commit, for the whole life of the tab.
   */
  it("lets Val's commit message replace a host message already held", () => {
    const prev: ValEnrichedDeployment[] = [
      {
        commitSha: "abc123",
        deploymentState: "pending",
        commitMessage: "val: update hero copy [skip ci]",
        creator: null,
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:30:00Z",
      },
    ];
    const result = mergeCommitsAndDeployments(
      prev,
      [
        {
          commitSha: "abc123",
          clientCommitSha: "client-abc123",
          parentCommitSha: "parent-abc123",
          branch: "main",
          commitMessage: "Update hero copy",
          creator: "user1",
          createdAt: "2023-01-01T00:00:00Z",
        },
      ],
      [],
    );
    expect(result[0].commitMessage).toBe("Update hero copy");
    // And the author, which a deployment-only row never has.
    expect(result[0].creator).toBe("user1");
    // What the HOST reports is still the host's: the build state and the time
    // it last moved are not Val's to overwrite.
    expect(result[0].deploymentState).toBe("pending");
    expect(result[0].updatedAt).toBe("2023-01-01T00:30:00Z");
  });

  it("keeps the host's message when Val's commit has none", () => {
    const result = mergeCommitsAndDeployments(
      [
        {
          commitSha: "abc123",
          deploymentState: "success",
          commitMessage: "Bump the dependency",
          creator: null,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T00:30:00Z",
        },
      ],
      [
        {
          commitSha: "abc123",
          clientCommitSha: "client-abc123",
          parentCommitSha: "parent-abc123",
          branch: "main",
          commitMessage: null,
          creator: "user1",
          createdAt: "2023-01-01T00:00:00Z",
        },
      ],
      [],
    );
    expect(result[0].commitMessage).toBe("Bump the dependency");
  });

  /**
   * The result is fed back in as `prev` on the next poll, so without a bound
   * this function is an accumulator: every commit and deployment a session ever
   * saw stayed in it for as long as the tab was open. That is what the deploy
   * list's per-row dismiss button was for, and the bound is what replaced it.
   */
  it("keeps only the newest few", () => {
    const deployments: ValDeployment[] = Array.from(
      { length: 40 },
      (_, index) => ({
        commitSha: `sha-${index}`,
        deploymentId: `deployment-${index}`,
        deploymentState: "success",
        createdAt: new Date(2000 + index * 1000).toISOString(),
        updatedAt: new Date(2000 + index * 1000).toISOString(),
      }),
    );
    const result = mergeCommitsAndDeployments([], [], deployments);
    expect(result).toHaveLength(25);
    // Newest first, and it is the NEWEST that survive: the oldest fall off the
    // end, which is the whole point of the bound.
    expect(result[0].commitSha).toBe("sha-39");
    expect(result[result.length - 1].commitSha).toBe("sha-15");
  });

  it("drops what it already held once newer publishes crowd it out", () => {
    const at = (index: number) => new Date(2000 + index * 1000).toISOString();
    const prev: ValEnrichedDeployment[] = Array.from(
      { length: 25 },
      (_, index) => ({
        commitSha: `old-${index}`,
        deploymentState: "success",
        commitMessage: null,
        creator: null,
        createdAt: at(index),
        updatedAt: at(index),
      }),
    );
    const result = mergeCommitsAndDeployments(
      prev,
      [],
      [
        {
          commitSha: "new",
          deploymentId: "deployment-new",
          deploymentState: "pending",
          createdAt: at(100),
          updatedAt: at(100),
        },
      ],
    );
    expect(result).toHaveLength(25);
    expect(result[0].commitSha).toBe("new");
    expect(result.some((d) => d.commitSha === "old-0")).toBe(false);
  });
});
