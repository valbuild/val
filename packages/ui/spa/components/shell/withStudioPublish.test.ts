import { withStudioPublish } from "./shellDataMapping";
import type { ShellDeployment } from "./types";

const row = (commitSha: string): ShellDeployment => ({
  commitSha,
  state: "success",
  message: null,
  timestamp: "just now",
  updatedAt: "2026-09-24T12:00:00Z",
  isLive: false,
});

const rows = [row("new"), row("old")];

describe("this Studio's publish, on its row", () => {
  test("while it runs: the step and how far it has got", () => {
    const [mine, other] = withStudioPublish(rows, {
      status: "running",
      phase: { kind: "building" },
      startedAt: 0,
      phaseStartedAt: 0,
      commit: "new",
    });
    expect(mine.publish).toEqual({
      kind: "running",
      percent: 12,
      step: "Building",
    });
    expect(other.publish).toBeUndefined();
  });

  test("once live: how long each step took", () => {
    const [mine] = withStudioPublish(rows, {
      status: "done",
      result: { status: "live", url: null, visible: true },
      ms: 29_000,
      steps: [
        { kind: "building", ms: 6_000 },
        { kind: "propagating", ms: 6_000 },
      ],
      commit: "new",
    });
    expect(mine.publish).toEqual({
      kind: "done",
      ms: 29_000,
      steps: [
        { label: "Building", ms: 6_000 },
        { label: "Waiting for the site to show it", ms: 6_000 },
      ],
    });
  });

  test("a failed one is left to its own message", () => {
    const listed = withStudioPublish(rows, {
      status: "done",
      result: { status: "failed", message: "no", problems: [] },
      ms: 1,
      steps: [],
      commit: "new",
    });
    expect(listed).toBe(rows);
  });

  test("a publish of no commit has no row to go on", () => {
    const listed = withStudioPublish(rows, {
      status: "running",
      phase: { kind: "building" },
      startedAt: 0,
      phaseStartedAt: 0,
      commit: null,
    });
    expect(listed).toBe(rows);
  });
});
