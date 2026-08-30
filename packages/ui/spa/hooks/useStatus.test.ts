import { awaitingDeploymentInterval, StatData } from "./useStatus";

/**
 * How hard the Studio leans on `/stat` while a publish is on its way out.
 *
 * `/stat` is the only thing that reports which commit the site is actually
 * serving — the app reads it from its environment at boot, so a finished deploy
 * is a new process answering with a new sha — and that is how Val decides a
 * publish has landed. Nothing pushes it, so how quickly a publish stops reading
 * as "Building" is decided entirely here.
 */

const MINUTE = 60 * 1000;
const now = new Date("2026-08-25T12:00:00Z").getTime();
const ago = (millis: number) => new Date(now - millis).toISOString();

const stat = (overrides: Partial<StatData>): StatData => ({
  type: "use-websocket",
  profileId: "profile-ada",
  config: {},
  commitSha: "servingthis",
  sourcesSha: "sources",
  schemaSha: "schema",
  baseSha: "base",
  patches: [],
  mode: "http",
  ...overrides,
});

const commit = (commitSha: string, createdAt: string) => ({
  commitSha,
  clientCommitSha: commitSha,
  parentCommitSha: "parent",
  branch: "main",
  commitMessage: "A change",
  creator: "profile-ada",
  createdAt,
});

const deployment = (commitSha: string, createdAt: string) => ({
  deploymentId: `deployment-${commitSha}`,
  commitSha,
  deploymentState: "pending",
  createdAt,
  updatedAt: createdAt,
});

describe("awaitingDeploymentInterval", () => {
  test("has no opinion when there is nothing to wait for", () => {
    expect(awaitingDeploymentInterval(undefined, now)).toBe(Infinity);
    expect(awaitingDeploymentInterval(stat({}), now)).toBe(Infinity);
  });

  // fs mode long-polls and has no deployments, and a stat with no commit sha
  // cannot say what is outstanding either way.
  test("has no opinion without a commit sha to compare against", () => {
    expect(
      awaitingDeploymentInterval(
        stat({ commitSha: undefined, commits: [commit("other", ago(0))] }),
        now,
      ),
    ).toBe(Infinity);
  });

  test("has no opinion when the site already serves everything Val knows of", () => {
    expect(
      awaitingDeploymentInterval(
        stat({
          commits: [commit("servingthis", ago(5 * MINUTE))],
          deployments: [deployment("servingthis", ago(5 * MINUTE))],
        }),
        now,
      ),
    ).toBe(Infinity);
  });

  test("polls quickly right after a publish", () => {
    expect(
      awaitingDeploymentInterval(
        stat({ commits: [commit("justpublished", ago(0))] }),
        now,
      ),
    ).toBe(5000);
  });

  // A commit pushed outside the Studio can reach Val as a deployment alone.
  test("a deployment with no commit counts as something to wait for", () => {
    expect(
      awaitingDeploymentInterval(
        stat({ deployments: [deployment("fromci", ago(0))] }),
        now,
      ),
    ).toBe(5000);
  });

  test("backs off as the build runs, so a stuck deploy is not polled forever", () => {
    const at = (waited: number) =>
      awaitingDeploymentInterval(
        stat({ commits: [commit("building", ago(waited))] }),
        now,
      );
    expect(at(4 * MINUTE)).toBe(MINUTE);
    expect(at(20 * MINUTE)).toBe(5 * MINUTE);
    // Capped at the idle interval rather than growing without bound.
    expect(at(10 * 60 * MINUTE)).toBe(20 * MINUTE);
  });

  // The newest one: an old publish that is never going to land would otherwise
  // hold the poll at its own backed-off pace while a fresh one waits behind it.
  test("paces on the most recent publish still out", () => {
    expect(
      awaitingDeploymentInterval(
        stat({
          commits: [
            commit("stuck", ago(60 * MINUTE)),
            commit("fresh", ago(4 * MINUTE)),
          ],
        }),
        now,
      ),
    ).toBe(MINUTE);
  });

  test("ignores a timestamp it cannot read", () => {
    expect(
      awaitingDeploymentInterval(
        stat({ commits: [commit("weird", "not a date")] }),
        now,
      ),
    ).toBe(Infinity);
  });
});
