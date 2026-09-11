import type { ValConfig } from "@valbuild/core";
import { clientConfig } from "./clientConfig";

/**
 * Which branch the Studio is told about.
 *
 * The case that matters is proxy mode with no `gitBranch` in `val.config`,
 * which is not an edge: naming the branch in the environment is how a Vercel
 * deployment does it, and `examples/next` does not name one at all. The Studio
 * reads `config.gitBranch` and nothing else, so getting this wrong is a History
 * pane telling an editor the project is unconfigured while the server behind it
 * commits to a branch.
 */
describe("clientConfig", () => {
  test("fills in the resolved branch when val.config names none", () => {
    const res = clientConfig({
      mode: "http",
      branch: "main",
      config: { project: "org/app" },
    });

    expect(res.gitBranch).toBe("main");
    // Everything else passes through untouched.
    expect(res.project).toBe("org/app");
  });

  test("val.config wins over the environment", () => {
    const res = clientConfig({
      mode: "http",
      branch: "main",
      config: { project: "org/app", gitBranch: "content" },
    });

    expect(res.gitBranch).toBe("content");
  });

  test("fs mode is not given a branch", () => {
    // `ValOpsFS` has no commits of its own, so there is nothing for a branch to
    // list. The shell hides what needs one; inventing a name would make the
    // History pane offer a list that can only answer `not-supported-in-fs-mode`.
    const res = clientConfig({ mode: "fs", config: { project: "org/app" } });

    expect(res.gitBranch).toBeUndefined();
  });

  test("does not mutate the config it was given", () => {
    // The same object is handed to every `/stat`, so a mutation here would
    // outlive the request that caused it.
    const config: ValConfig = { project: "org/app" };

    clientConfig({ mode: "http", branch: "main", config });

    expect(config.gitBranch).toBeUndefined();
  });
});
