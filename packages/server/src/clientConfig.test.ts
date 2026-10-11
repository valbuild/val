import type { ValConfig } from "@valbuild/core";
import { Api } from "@valbuild/shared/internal";
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
      git: { branch: "main" },
      config: { project: "org/app" },
    });

    expect(res.gitBranch).toBe("main");
    // Everything else passes through untouched.
    expect(res.project).toBe("org/app");
  });

  test("val.config wins over the environment", () => {
    const res = clientConfig({
      mode: "http",
      git: { branch: "main" },
      config: { project: "org/app", gitBranch: "content" },
    });

    expect(res.gitBranch).toBe("content");
  });

  test("http with no git mirror is not given a branch either", () => {
    // Git became optional in http mode: a project can run on credentials alone
    // with no repository to mirror into. There is then no branch to fill in,
    // and saying one would name a repository that does not exist.
    const res = clientConfig({ mode: "http", config: { project: "org/app" } });

    expect(res.gitBranch).toBeUndefined();
  });

  test("fs mode is not given a branch", () => {
    // `ValOpsFS` has no commits of its own, so there is nothing for a branch to
    // list. The shell hides what needs one; inventing a name would make the
    // History pane offer a list that can only answer `not-supported-in-fs-mode`.
    const res = clientConfig({ mode: "fs", config: { project: "org/app" } });

    expect(res.gitBranch).toBeUndefined();
  });

  test("fills in the resolved project when val.config names none", () => {
    // `VAL_PROJECT` instead of `project` in val.config. The Studio only offers
    // the assistant to a config with a project, so leaving it out would hide
    // the assistant from a project the server is serving.
    const res = clientConfig({ mode: "fs", project: "org/app", config: {} });

    expect(res.project).toBe("org/app");
  });

  test("val.config's project wins over the environment's", () => {
    const res = clientConfig({
      mode: "http",
      project: "org/from-env",
      git: { branch: "main" },
      config: { project: "org/app" },
    });

    expect(res.project).toBe("org/app");
  });

  test("a project with none configured anywhere stays without one", () => {
    const res = clientConfig({ mode: "fs", config: {} });

    expect(res.project).toBeUndefined();
  });

  test("does not mutate the config it was given", () => {
    // The same object is handed to every `/stat`, so a mutation here would
    // outlive the request that caused it.
    const config: ValConfig = { project: "org/app" };

    clientConfig({ mode: "http", git: { branch: "main" }, config });

    expect(config.gitBranch).toBeUndefined();
  });
});

/**
 * And that it survives the wire, which `clientConfig` alone cannot promise.
 *
 * The branch crosses three schemas on its way to the History button, and each
 * of them is a place it can be dropped in silence: `clientConfig` puts it on
 * the response, `ApiRoutes` validates that response in the browser, and
 * `useStatus`'s `StatData` types what the Studio reads back. A zod object
 * strips what it does not declare, so a missing line in the middle schema
 * would leave a server that resolves the branch, a Studio that never sees it,
 * and a History door that is hidden for the exact projects this was added for
 * — with nothing failing anywhere.
 *
 * Pinned against the SHARED contract rather than against a hand-written shape,
 * because that is the schema the real client parses with.
 */
describe("the resolved branch reaches the Studio", () => {
  test("survives the /stat response schema", () => {
    const statRes = Api["/stat"].POST.res;
    const parsed = statRes.safeParse({
      status: 200,
      json: {
        type: "did-change",
        profileId: null,
        config: clientConfig({
          mode: "http",
          git: { branch: "release/2026-09" },
          config: { project: "org/app" },
        }),
        mode: "http",
        baseSha: "base",
        schemaSha: "schema",
        sourcesSha: "sources",
        patches: [],
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    /*
     * Read off the PARSED value, not the input: reading the input back would
     * pass whether or not the schema declares the field, which is the whole
     * thing this test exists to catch.
     */
    expect(parsed.data.json).toHaveProperty("config.gitBranch");
    if (!("config" in parsed.data.json)) return;
    expect(parsed.data.json.config.gitBranch).toBe("release/2026-09");
  });
});
