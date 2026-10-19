import type { ModuleFilePath } from "@valbuild/core";
import type { BuildTargetResponse, Evaluated } from "@valbuild/shared/internal";
import type { JSONValue } from "@valbuild/core/patch";
import type {
  ProposalJson,
  ProposalsClient,
  UpdateCodeAnswer,
  UpdateCodeRequest,
} from "./proposalsClient";
import { updateProposalWithCode, type CodeUpdateDeps } from "./updateWithCode";

/*
 * The tab's half of Update from the site with code: the trees read, each
 * bundled and evaluated, merged by Val's server, the merge evaluated and sent
 * back. Content, the server, the builder and the worker are fakes here; each
 * is tested where it lives.
 */

const HERO = "src/components/Hero.tsx";
const HOME = "/home.val.ts" as ModuleFilePath;
const trees = (
  over: Partial<Awaited<ReturnType<ProposalsClient["mergeTrees"]>>> = {},
) => ({
  base: "site-1",
  siteHead: "site-2",
  proposalHead: "save-2",
  upToDate: false,
  builds: { base: "build-a", site: "build-b" },
  trees: {
    site: { "val.modules.ts": "site", [HERO]: "hero b" },
    base: { [HERO]: "hero a" },
    proposal: { [HERO]: "hero c", "gone.ts": null },
  },
  modules: { [HOME]: { base: "sha-a", site: "sha-b", proposal: "sha-a" } },
  sources: { "sha-a": { title: "Sale" }, "sha-b": { title: "Spring sale" } },
  ...over,
});
const TARGET: BuildTargetResponse = {
  base: {
    rev: "b1",
    shellRev: "s1",
    rscShellRev: "s1",
    modules: {},
    rscModules: {},
    paths: {
      baseFromProject: "../vendor/",
      projectVendorDir: "pvendor/",
      rscVendorBase: "../vendor/",
      rscRuntimeSpecifier: "platform:rsc",
      rscRuntimePath: "rsc/runtime.js",
      flightServer: "flight",
      serverFnBase: "/_serverFn/",
    },
  },
  project: { rev: "r1", rsc: false, modules: {}, css: {}, workerOnly: [] },
};
const PROPOSAL: ProposalJson = {
  name: "p",
  branch: "val/p/p",
  displayName: "Summer",
  status: "open",
  updatedAt: "2026-10-16T00:00:00Z",
};

/** Each tree is "bundled" to its hero's text, so what was evaluated can be read back. */
function fakes(answers: UpdateCodeAnswer[]) {
  const sent: UpdateCodeRequest[] = [];
  const evaluations: {
    code: string;
    sources: Record<string, JSONValue | null>;
  }[] = [];
  const deps: CodeUpdateDeps = {
    client: {
      mergeTrees: async () => trees(),
      updateCode: async (_name, body) => {
        sent.push(body);
        return answers.shift()!;
      },
    },
    buildTarget: async () => TARGET,
    bundle: async ({ files, origin }) => ({
      code: `${origin}:${files[HERO] ?? "(no hero)"}:${"gone.ts" in files}`,
    }),
    evaluate: async (code, sources) => {
      evaluations.push({ code, sources });
      const evaluated: Evaluated = {};
      evaluated[HOME] = {
        schema: {
          type: "string",
          opt: false,
          raw: false,
          customValidate: false,
        },
        written: code,
        errors: [],
      };
      return evaluated;
    },
    origin: "https://p.example",
  };
  return { deps, sent, evaluations };
}

describe("updateProposalWithCode", () => {
  test("each tree is evaluated with its own Source, the merge is evaluated over the site's tree, and both are sent", async () => {
    const { deps, sent, evaluations } = fakes([
      {
        status: "evaluate",
        id: "m-1",
        files: { [HERO]: "hero c" },
        sources: { [HOME]: { title: "Spring sale" } },
      },
      { status: "updated", commit: "merge-1", proposal: PROPOSAL },
    ]);

    const outcome = await updateProposalWithCode("p", [], deps);

    expect(outcome).toEqual({ status: "updated", proposal: PROPOSAL });
    expect(evaluations).toEqual([
      // base: the site's tree with the base's changes over it
      {
        code: "https://p.example:hero a:false",
        sources: { [HOME]: { title: "Sale" } },
      },
      {
        code: "https://p.example:hero b:false",
        sources: { [HOME]: { title: "Spring sale" } },
      },
      {
        code: "https://p.example:hero c:false",
        sources: { [HOME]: { title: "Sale" } },
      },
      // the merge, over the site's tree, with the content it wrote
      {
        code: "https://p.example:hero c:false",
        sources: { [HOME]: { title: "Spring sale" } },
      },
    ]);
    expect(sent[0]).toMatchObject({
      siteHead: "site-2",
      proposalHead: "save-2",
      builds: { base: "build-a", site: "build-b" },
      resolutions: [],
    });
    expect(sent[0]?.merged).toBeUndefined();
    expect(sent[1]?.merged).toEqual({
      id: "m-1",
      evaluated: {
        [HOME]: expect.objectContaining({
          written: "https://p.example:hero c:false",
        }),
      },
    });
  });

  test("conflicts come back for a person, after one call", async () => {
    const conflict = {
      kind: "code" as const,
      file: HERO,
      base: "hero a",
      site: "hero b",
      proposal: "hero c",
    };
    const { deps, sent } = fakes([
      { status: "conflicts", conflicts: [conflict] },
    ]);
    expect(await updateProposalWithCode("p", [], deps)).toEqual({
      status: "conflicts",
      conflicts: [conflict],
    });
    expect(sent).toHaveLength(1);
  });

  test("up to date: nothing is evaluated", async () => {
    const { deps, evaluations, sent } = fakes([]);
    deps.client.mergeTrees = async () => trees({ upToDate: true });
    expect(await updateProposalWithCode("p", [], deps)).toEqual({
      status: "up-to-date",
    });
    expect(evaluations).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("a tree that cannot be evaluated fails the update, saying why", async () => {
    const { deps } = fakes([]);
    deps.evaluate = async () => {
      throw new Error("The project's Val modules could not be read: boom");
    };
    await expect(updateProposalWithCode("p", [], deps)).rejects.toThrow(/boom/);
  });
});
