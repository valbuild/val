import type { UpdateTargetResponse } from "@valbuild/shared/internal";
import { runSiteUpdate } from "./runSiteUpdate";
import type { UseStudioDeploy } from "./useStudioDeploy";

/**
 * The update, as the Studio runs it.
 *
 * Three things are pinned, because each one fails silently when it is wrong:
 * the rebuild is handed the rewritten `package.json` and nothing else (so no
 * editor's unpublished work goes out with it), it is built against the
 * update's target rather than the live build's, and it is wired at the branch
 * head content named.
 */

const target = {
  base: {
    rev: "base-1",
    shellRev: "shell-1",
    rscShellRev: "rsc-1",
    modules: {},
    rscModules: {},
    paths: {
      baseFromProject: "../base/",
      projectVendorDir: "v/",
      rscVendorBase: "rv/",
      rscRuntimeSpecifier: "rt",
      rscRuntimePath: "rt.js",
      flightServer: "fs.js",
      serverFnBase: "sf/",
    },
  },
  project: {
    rev: "seed-layer",
    rsc: false,
    modules: {},
    css: {},
    workerOnly: [],
  },
};

const available: UpdateTargetResponse = {
  status: "available",
  template: "template",
  changes: [
    {
      name: "@valbuild/core",
      section: "dependencies",
      from: "0.136.8",
      to: "0.140.0",
    },
  ],
  layerRev: { from: "old-layer", to: "seed-layer" },
  packageJson: '{"dependencies":{"@valbuild/core":"0.140.0"}}\n',
  commit: "head-commit",
  branch: "main",
  target,
};

type DeployCall = Parameters<UseStudioDeploy["deploy"]>;

function deployer(
  result: Awaited<ReturnType<UseStudioDeploy["deploy"]>> = {
    result: { status: "live", url: "https://site.test" },
    failedAt: null,
  },
) {
  const calls: DeployCall[] = [];
  const deploy: UseStudioDeploy["deploy"] = async (...args) => {
    calls.push(args);
    return result;
  };
  return { calls, deploy };
}

const client = (answer: UpdateTargetResponse | Error) => {
  const modes: string[] = [];
  return {
    modes,
    client: {
      updateTarget: async (mode: "check" | "start") => {
        modes.push(mode);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
};

describe("an update", () => {
  test("starts, then rebuilds with the new package.json at the head", async () => {
    const { client: c, modes } = client(available);
    const { calls, deploy } = deployer();
    const outcome = await runSiteUpdate({ client: c, deploy });
    expect(outcome).toEqual({ status: "updated", changes: available.changes });
    // `start`, which is the one that copies the layer -- not `check`.
    expect(modes).toEqual(["start"]);
    expect(calls).toHaveLength(1);
    const [commit, committedFiles, details] = calls[0];
    expect(commit).toBe("head-commit");
    expect(committedFiles).toEqual({ "package.json": available.packageJson });
    expect(details).toMatchObject({
      binaryFiles: null,
      branch: "main",
      target,
    });
  });

  test("builds nothing when there is nothing to update to", async () => {
    const { calls, deploy } = deployer();
    await expect(
      runSiteUpdate({
        client: client({
          status: "current",
          template: "template",
          layerRev: "seed-layer",
        }).client,
        deploy,
      }),
    ).resolves.toEqual({ status: "current" });
    expect(calls).toEqual([]);
  });

  test("says why when the platform will not update it", async () => {
    const { calls, deploy } = deployer();
    await expect(
      runSiteUpdate({
        client: client({
          status: "unavailable",
          reason: "own-dependencies",
          message: "This project depends on left-pad.",
        }).client,
        deploy,
      }),
    ).resolves.toEqual({
      status: "unavailable",
      message: "This project depends on left-pad.",
    });
    expect(calls).toEqual([]);
  });

  test("a start with no target builds nothing, rather than the old layer", async () => {
    const { calls, deploy } = deployer();
    const noTarget: UpdateTargetResponse = { ...available, target: undefined };
    const outcome = await runSiteUpdate({
      client: client(noTarget).client,
      deploy,
    });
    expect(outcome.status).toBe("failed");
    expect(calls).toEqual([]);
  });

  test("a failed check says the site is unchanged, with content's problems", async () => {
    const { deploy } = deployer({
      result: {
        status: "failed",
        message: "verify refused",
        problems: [{ code: "PLATFORM501", message: "render failed" }],
      },
      failedAt: "verifying",
    });
    const outcome = await runSiteUpdate({
      client: client(available).client,
      deploy,
    });
    expect(outcome).toMatchObject({
      status: "failed",
      message: expect.stringContaining("unchanged"),
      details: expect.stringContaining("PLATFORM501: render failed"),
    });
  });

  test("never throws", async () => {
    const { deploy } = deployer();
    await expect(
      runSiteUpdate({ client: client(new Error("502")).client, deploy }),
    ).resolves.toMatchObject({ status: "failed", details: "502" });
  });
});
