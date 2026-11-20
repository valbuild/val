import type { ServerBuildProgress } from "@valbuild/shared/publish";
import { proposalBuildProgress } from "./proposalBuildProgress";
import type { StudioDeployState } from "../publish/useStudioDeploy";

const idle: StudioDeployState = { status: "idle" };
const onServer = (progress: ServerBuildProgress | null | undefined) =>
  proposalBuildProgress({ kind: "on-server", since: 0, progress }, idle);

describe("a build on Val Build, as the Studio shows it", () => {
  test("without anything said, it is building, with no percent", () => {
    expect(onServer(null)).toEqual({
      label: "Building on Val Build",
      percent: null,
    });
    expect(onServer(undefined)).toEqual({
      label: "Building on Val Build",
      percent: null,
    });
  });

  test("waiting in the queue says how many are ahead", () => {
    expect(onServer({ queued: 2, step: null, built: false })).toEqual({
      label: "Waiting for Val Build: 2 builds ahead",
      percent: 0,
    });
  });

  test("the builder's steps fill most of the bar, in order, and never reach the end", () => {
    const percents = [1, 2, 3, 4].map(
      (index) =>
        onServer({
          queued: null,
          step: { label: "Building the site", index, of: 4 },
          built: false,
        }).percent ?? -1,
    );
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents[0]).toBeGreaterThan(0);
    expect(percents[3]).toBeLessThan(85);
    expect(
      onServer({
        queued: null,
        step: { label: "Building the site", index: 3, of: 4 },
        built: false,
      }).label,
    ).toBe("Building the site");
  });

  test("built: the rest is checking and serving it", () => {
    expect(onServer({ queued: null, step: null, built: true })).toEqual({
      label: "Checking the page and serving it",
      percent: 85,
    });
  });
});
