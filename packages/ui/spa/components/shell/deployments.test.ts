import { summarizeDeployments } from "./Deployments";
import { formatRelativeTime, toDeployments } from "./shellDataMapping";
import { ShellDeployment } from "./types";

/**
 * The deploy feed's two decisions: what the status bar says about a set of
 * publishes, and how a `ValEnrichedDeployment` becomes a row.
 */

const deployment = (
  overrides: Partial<ShellDeployment> & Pick<ShellDeployment, "commitSha">,
): ShellDeployment => ({
  state: "success",
  message: "A change",
  timestamp: "just now",
  isLive: true,
  ...overrides,
});

describe("summarizeDeployments", () => {
  test("says nothing has been published when the feed is empty", () => {
    expect(summarizeDeployments([])).toEqual({ state: "none" });
  });

  test("a publish in flight wins over anything already finished", () => {
    expect(
      summarizeDeployments([
        deployment({ commitSha: "a", state: "pending" }),
        deployment({ commitSha: "b", state: "failure" }),
      ]),
    ).toEqual({ state: "building", count: 1 });
  });

  // A commit Val has made that no deployment has claimed yet is still on its
  // way out, so it counts as building rather than as a state of its own.
  test("counts commits with no deployment yet as building", () => {
    expect(
      summarizeDeployments([
        deployment({ commitSha: "a", state: "created" }),
        deployment({ commitSha: "b", state: "pending" }),
      ]),
    ).toEqual({ state: "building", count: 2 });
  });

  test("only the newest publish decides the resting state", () => {
    expect(
      summarizeDeployments([
        deployment({ commitSha: "new", state: "success" }),
        deployment({ commitSha: "old", state: "failure" }),
      ]),
    ).toEqual({ state: "live" });
  });

  test("reports a failure that nothing newer has fixed", () => {
    expect(
      summarizeDeployments([
        deployment({ commitSha: "new", state: "error" }),
        deployment({ commitSha: "old", state: "success" }),
      ]),
    ).toEqual({ state: "failed" });
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-08-25T12:00:00Z").getTime();
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  test.each([
    [ago(5), "just now"],
    [ago(44), "just now"],
    [ago(60), "1 minute ago"],
    [ago(120), "2 minutes ago"],
    [ago(60 * 60), "1 hour ago"],
    [ago(60 * 60 * 5), "5 hours ago"],
    [ago(60 * 60 * 24), "1 day ago"],
    [ago(60 * 60 * 24 * 9), "9 days ago"],
  ])("%s reads as %s", (iso, expected) => {
    expect(formatRelativeTime(iso, now)).toBe(expected);
  });

  // Clocks disagree, and a deployment stamped a second into the future should
  // not read as "in -1 minutes".
  test("a timestamp from the future reads as just now", () => {
    expect(formatRelativeTime(ago(-30), now)).toBe("just now");
  });

  test("an unparseable timestamp is shown rather than guessed at", () => {
    expect(formatRelativeTime("not a date", now)).toBe("not a date");
  });
});

describe("toDeployments", () => {
  const now = new Date("2026-08-25T12:00:00Z").getTime();
  const enriched = {
    deploymentState: "pending" as const,
    commitMessage: "Update the hero",
    creator: "ada",
    commitSha: "abc1234def",
    createdAt: "2026-08-25T11:00:00Z",
    updatedAt: "2026-08-25T11:58:00Z",
  };

  test("names the author from the profile, not from the id", () => {
    const [row] = toDeployments(
      [enriched],
      new Set(),
      { ada: { fullName: "Ada Lovelace" } },
      now,
    );
    expect(row.author).toBe("Ada Lovelace");
    expect(row.message).toBe("Update the hero");
    expect(row.timestamp).toBe("2 minutes ago");
  });

  test("leaves the author out when no profile has loaded for them", () => {
    const [row] = toDeployments([enriched], new Set(), {}, now);
    expect(row.author).toBeUndefined();
  });

  // A green build is not the same as a page that answers with the new commit,
  // so "live" comes from what Val has observed, not from the build state.
  test("marks a publish live only once Val has seen the commit serving", () => {
    const built = { ...enriched, deploymentState: "success" as const };
    expect(toDeployments([built], new Set(), {}, now)[0].isLive).toBe(false);
    expect(
      toDeployments([built], new Set(["abc1234def"]), {}, now)[0].isLive,
    ).toBe(true);
  });

  test("keeps the feed short enough to read", () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      ...enriched,
      commitSha: `sha-${index}`,
    }));
    expect(toDeployments(many, new Set(), {}, now)).toHaveLength(10);
  });
});
