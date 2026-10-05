import {
  awaitingDeploymentInterval,
  chainOfMessage,
  holdsOfAnswer,
  holdsOfMessage,
  StatData,
} from "./useStatus";
import { heldByContent } from "../publish/publishJobs";

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

describe("chainOfMessage", () => {
  const message = {
    type: "patches" as const,
    patches: ["p1", "p2"] as StatData["patches"],
    headPatchId: "p2" as StatData["patches"][number],
    headVersion: 7,
    patchGroups: [],
  };

  // A publish moves the groups and the applied list at once. Kept apart, the
  // publisher's other tabs saw the new groups beside the old applied list,
  // read the published change as unstaged, and showed the old value.
  test("takes which patches are applied from the message, with the groups", () => {
    expect(
      chainOfMessage(
        { appliedPatches: [] },
        { ...message, appliedPatches: ["p1"] as StatData["patches"] },
      ),
    ).toEqual({
      patches: ["p1", "p2"],
      headPatchId: "p2",
      headVersion: 7,
      patchGroups: [],
      appliedPatches: ["p1"],
    });
  });

  // Publishing is NOT one-way: a job that fails gives its changes back, so the
  // message's set replaces the last one rather than adding to it. Accumulated,
  // a failed publish would have held Publish off for good.
  test("replaces which patches are publishing with the message's set", () => {
    expect(
      chainOfMessage(
        { publishingPatches: ["p1", "p2"] as StatData["patches"] },
        { ...message, publishingPatches: [] as StatData["patches"] },
      ).publishingPatches,
    ).toEqual([]);
  });

  // An older content service does not send it, which is "not reported".
  test("keeps the previous publishing set when the message has none", () => {
    expect(
      chainOfMessage(
        { publishingPatches: ["p1"] as StatData["patches"] },
        message,
      ).publishingPatches,
    ).toEqual(["p1"]);
  });

  // Applied is one-way: a content service that does not send the list leaves
  // the last one standing, which is incomplete but never wrong.
  test("keeps the previous applied list when the message has none", () => {
    expect(
      chainOfMessage({ appliedPatches: ["p1"] as StatData["patches"] }, message)
        .appliedPatches,
    ).toEqual(["p1"]);
  });
});

describe("content's holds", () => {
  const ids = (...patchIds: string[]) => patchIds as StatData["patches"];
  const answer = {
    patches: ids("p1"),
    appliedPatches: ids(),
    publishingPatches: ids(),
  };

  // Requested before another tab pressed Publish, answered after the socket
  // said what that publish holds: the socket is newer.
  test("keep the socket's when the socket spoke after the request", () => {
    const fromSocket = { patches: ids("p1"), publishingPatches: ids("p1") };
    expect(holdsOfAnswer(fromSocket, answer, true)).toBe(fromSocket);
  });

  test("take the answer's when nothing newer arrived", () => {
    expect(
      holdsOfAnswer(
        { patches: ids("p1"), publishingPatches: ids("p1") },
        answer,
        false,
      ),
    ).toEqual(answer);
  });

  test("take the answer's when there are none yet", () => {
    expect(holdsOfAnswer(undefined, answer, true)).toEqual(answer);
  });

  /*
   * The socket reports p1's publish sealed -- applied, held by nobody -- and
   * then a `/stat` answer requested before the seal lands, with p1 still
   * unapplied and held. Pairing the socket's publishing set with the answer's
   * applied list read p1 as pending and held by nobody: given back, and
   * offered for Publish again while the store was still taking in the seal.
   */
  test("never pair the socket's publishing set with an older answer's applied list", () => {
    const sealedOnSocket = holdsOfMessage(
      {
        patches: ids("p1"),
        appliedPatches: ids(),
        publishingPatches: ids("p1"),
      },
      {
        type: "patches",
        patches: ids("p1"),
        headPatchId: ids("p1")[0],
        headVersion: 2,
        patchGroups: [],
        appliedPatches: ids("p1"),
        publishingPatches: ids(),
      },
    );
    const olderAnswer = {
      patches: ids("p1"),
      appliedPatches: ids(),
      publishingPatches: ids("p1"),
    };
    const holds = holdsOfAnswer(sealedOnSocket, olderAnswer, true);
    expect(holds.appliedPatches).toEqual(["p1"]);
    expect([...heldByContent(new Set(["p1"]), holds)]).toEqual(["p1"]);
  });

  test("a message without the lists keeps the ones before it", () => {
    expect(
      holdsOfMessage(
        {
          patches: ids("p1"),
          appliedPatches: ids("p0"),
          publishingPatches: ids("p1"),
        },
        {
          type: "patches",
          patches: ids("p1", "p2"),
          headPatchId: ids("p2")[0],
          headVersion: 3,
          patchGroups: [],
        },
      ),
    ).toEqual({
      patches: ["p1", "p2"],
      appliedPatches: ["p0"],
      publishingPatches: ["p1"],
    });
  });
});
