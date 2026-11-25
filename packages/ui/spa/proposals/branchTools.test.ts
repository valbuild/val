import { createValClient } from "@valbuild/shared/internal";
import { fetchCommitPage } from "../history/commitPage";
import {
  BRANCH_TOOLS,
  LOCAL_DEVELOPMENT,
  runBranchTool,
  type BranchToolDeps,
} from "./branchTools";
import { createProposalsClient, type ProposalJson } from "./proposalsClient";
import { createBranchesClient } from "./branchesClient";

const OPEN = "0123456789abcdef0123";
const MERGED = "aaaaaaaaaaaaaaaaaaaa";
const CLOSED = "bbbbbbbbbbbbbbbbbbbb";

const proposal = (
  name: string,
  over: Partial<ProposalJson> = {},
): ProposalJson => ({
  name,
  branch: `val/p/${name}`,
  displayName: `Proposal ${name.slice(0, 4)}`,
  ownerId: "ada",
  status: "open",
  updatedAt: "2026-10-07T10:00:00.000Z",
  changes: 1,
  ...over,
});

type Answer = { status: number; body: unknown };

/**
 * The network, and nothing else: Val's server answers by path. The proposals
 * client and the Val client in front of it are the Studio's own.
 */
function network(routes: Record<string, Answer>) {
  const asked: string[] = [];
  const answer = async (url: string): Promise<Response> => {
    const path = url.replace(/^\/api\/val/, "");
    asked.push(path);
    // A project with no repository, unless a test says otherwise: home's
    // answer for one (`handlers/branches.ts`).
    const found =
      routes[path] ??
      (path.startsWith("/branches-api")
        ? {
            status: 409,
            body: {
              message:
                "This project has no GitHub repository, so it has no branches to list.",
              details: { code: "no-repository" },
            },
          }
        : { status: 500, body: { message: `no route ${path}` } });
    return new Response(JSON.stringify(found.body), {
      status: found.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  const proposals = createProposalsClient({
    api: "/api/val",
    fetchImpl: (input) => answer(String(input)),
  });
  const valClient = createValClient("/api/val", null, {
    fetch: (input) => answer(input),
  });
  return { asked, proposals, valClient };
}

function depsOf(
  routes: Record<string, Answer>,
  over: Partial<BranchToolDeps> = {},
): { deps: BranchToolDeps; asked: string[] } {
  const { asked, proposals, valClient } = network(routes);
  return {
    asked,
    deps: {
      mode: "http",
      proposal: null,
      siteBranch: "main",
      client: proposals,
      commits: (branch, limit) =>
        fetchCommitPage(valClient, branch, limit, undefined),
      github: createBranchesClient(valClient),
      nameOf: (id) => (id === "ada" ? "Ada Lovelace" : null),
      ...over,
    },
  };
}

const commitsOf = (sha: string, message: string) => ({
  status: 200,
  body: {
    commits: [
      {
        commitSha: sha,
        parentCommitSha: null,
        clientCommitSha: null,
        branch: "main",
        createdBranch: null,
        creator: "ada",
        message,
        createdAt: "2026-11-01T09:00:00.000Z",
        seqNum: "1",
        patchCount: 1,
        hasArchive: true,
      },
    ],
    nextCursor: null,
  },
});

const listed = {
  status: 200,
  body: {
    proposals: [
      proposal(MERGED, {
        status: "merged",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }),
      proposal(OPEN, { updatedAt: "2026-11-02T00:00:00.000Z" }),
      proposal(CLOSED, {
        status: "closed",
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
    ],
  },
};

describe("the assistant's branch tools", () => {
  test("in local development, every one of them says there are no branches here", async () => {
    const { deps, asked } = depsOf({}, { mode: "fs" });
    for (const tool of BRANCH_TOOLS) {
      const answer = await runBranchTool(tool.name, {}, deps);
      expect(JSON.stringify(answer.result)).toContain(LOCAL_DEVELOPMENT);
    }
    // Nothing was asked of a server that has nothing to say
    expect(asked).toEqual([]);
  });

  test("where am I: on the site, and in a proposal", async () => {
    const onSite = await runBranchTool(
      "get_branch_context",
      {},
      depsOf({}).deps,
    );
    expect(onSite.result).toMatchObject({
      studio_branch: "main",
      site_branch: "main",
      proposal: null,
    });

    const inProposal = await runBranchTool(
      "get_branch_context",
      {},
      depsOf(
        {
          [`/proposals-api/${OPEN}`]: {
            status: 200,
            body: { proposal: proposal(OPEN) },
          },
        },
        { proposal: { name: OPEN, branch: `val/p/${OPEN}` } },
      ).deps,
    );
    expect(inProposal.result).toMatchObject({
      studio_branch: `val/p/${OPEN}`,
      site_branch: "main",
      proposal: { name: OPEN, title: "Proposal 0123", status: "open" },
    });
  });

  test("lists proposals newest first, earlier ones too, and filters by status", async () => {
    const { deps } = depsOf({ "/proposals-api": listed });
    const all = await runBranchTool("list_proposals", {}, deps);
    expect(
      (all.result as { proposals: Array<{ name: string; status: string }> })
        .proposals,
    ).toMatchObject([
      { name: OPEN, status: "open", branch: `val/p/${OPEN}` },
      { name: CLOSED, status: "closed" },
      { name: MERGED, status: "merged" },
    ]);
    const merged = await runBranchTool(
      "list_proposals",
      { status: "merged" },
      deps,
    );
    expect(
      (merged.result as { proposals: Array<{ name: string }> }).proposals.map(
        (p) => p.name,
      ),
    ).toEqual([MERGED]);
  });

  test("lists the site's branch and the open proposals' with their last commit", async () => {
    const { deps } = depsOf({
      "/proposals-api": listed,
      "/history/commits?branch=main&limit=1": commitsOf("abc", "Publish"),
      [`/history/commits?branch=val%2Fp%2F${OPEN}&limit=1`]: commitsOf(
        "def",
        "Save",
      ),
    });
    const answer = await runBranchTool("list_branches", {}, deps);
    expect(answer.isError).toBe(false);
    expect(answer.result).toMatchObject({
      branches: [
        {
          name: "main",
          site: true,
          this_studio: true,
          last_commit: { sha: "abc", message: "Publish", by: "Ada Lovelace" },
        },
        {
          name: `val/p/${OPEN}`,
          proposal: { name: OPEN, status: "open" },
          last_commit: { sha: "def", message: "Save" },
        },
      ],
    });
  });

  test("a project without proposals still lists the site's branch", async () => {
    const { deps } = depsOf({
      "/proposals-api": { status: 404, body: { message: "off" } },
      "/history/commits?branch=main&limit=1": commitsOf("abc", "Publish"),
    });
    const answer = await runBranchTool("list_branches", {}, deps);
    expect(answer.isError).toBe(false);
    expect(answer.result).toMatchObject({
      branches: [{ name: "main", last_commit: { sha: "abc" } }],
      proposals: "Proposals are not turned on.",
    });
  });

  test("a failing check says what clears it; the proposal can be named by title", async () => {
    const { deps } = depsOf({
      "/proposals-api": listed,
      [`/proposals-api/${OPEN}`]: {
        status: 200,
        body: {
          proposal: proposal(OPEN, {
            serverBuild: {
              state: "failed",
              inputs: "x",
              error: "Cannot find module './Hero'",
            },
          }),
        },
      },
      [`/proposals-api/${OPEN}/merge-checks`]: {
        status: 200,
        body: {
          canMerge: false,
          checks: [
            { id: "up-to-date", ok: true, message: "Up to date with the site" },
            {
              id: "build",
              ok: false,
              message: "The proposal has not been built",
              action: "build",
            },
          ],
        },
      },
    });
    const answer = await runBranchTool(
      "check_build",
      { proposal: "Proposal 0123" },
      deps,
    );
    expect(answer.isError).toBe(false);
    expect(answer.result).toMatchObject({
      can_publish: false,
      last_build: { status: "failed", error: "Cannot find module './Hero'" },
      checks: [
        { ok: true },
        {
          ok: false,
          next: expect.stringContaining("press Build beside this check"),
        },
      ],
    });
  });

  test("on the site of a project with no repository, check_build points at the proposals", async () => {
    const answer = await runBranchTool("check_build", {}, depsOf({}).deps);
    expect(answer.isError).toBe(true);
    expect(JSON.stringify(answer.result)).toContain(
      "Name a proposal (list_proposals) to check its build instead",
    );
  });

  test("signed out and unreachable are told apart, and only one is offered a retry", async () => {
    const signedOut = await runBranchTool(
      "list_proposals",
      {},
      depsOf({ "/proposals-api": { status: 401, body: { message: "no" } } })
        .deps,
    );
    expect(signedOut.result).toMatchObject({
      error: expect.stringContaining("sign in again"),
    });
    expect(signedOut.result).not.toHaveProperty("retry");
    const down = await runBranchTool(
      "list_proposals",
      {},
      depsOf({ "/proposals-api": { status: 502, body: {} } }).deps,
    );
    expect(down.result).toMatchObject({
      error: expect.stringContaining("could not be reached"),
      retry: true,
    });
  });

  describe("in a project connected to GitHub", () => {
    // valbuild/home `Api["/branches"]["GET"]["res"]`
    const githubBranches = {
      status: 200,
      body: {
        repository: {
          owner: "acme",
          repo: "site",
          url: "https://github.com/acme/site",
        },
        siteBranch: "main",
        total: 3,
        branches: [
          {
            name: "feature/hero",
            sha: "f1",
            message: "New hero",
            committedAt: "2026-11-03T00:00:00Z",
            author: "kari",
            proposal: null,
            isSiteBranch: false,
          },
          {
            name: `val/p/${OPEN}`,
            sha: "p1",
            message: "Spring",
            committedAt: "2026-11-02T00:00:00Z",
            author: "ada",
            proposal: OPEN,
            isSiteBranch: false,
          },
          {
            name: "main",
            sha: "m1",
            message: "Publish",
            committedAt: "2026-11-01T00:00:00Z",
            author: "ada",
            proposal: null,
            isSiteBranch: true,
          },
        ],
      },
    };
    // valbuild/home `Api["/branches/checks"]["GET"]["res"]`
    const failingCi = {
      status: 200,
      body: {
        branch: "feature/hero",
        sha: "f1",
        state: "failure",
        checks: [
          {
            name: "build",
            source: "check-run",
            status: "completed",
            conclusion: "failure",
            url: "https://github.com/acme/site/runs/1",
            summary: "Type error in Hero.tsx",
          },
        ],
        missingPermissions: ["statuses"],
        missingPermissionsMessage:
          "Some of acme/site's checks cannot be read: Val's GitHub App has not been allowed Commit statuses: read on it.",
      },
    };

    test("lists every branch of the repository, those made outside Val too", async () => {
      const { deps, asked } = depsOf({
        "/branches-api": githubBranches,
        "/proposals-api": listed,
      });
      const answer = await runBranchTool("list_branches", {}, deps);
      expect(answer.isError).toBe(false);
      expect(answer.result).toMatchObject({
        site_branch: "main",
        branches: [
          { name: "feature/hero", proposal: null, last_commit: { sha: "f1" } },
          {
            name: `val/p/${OPEN}`,
            proposal: { name: OPEN, title: "Proposal 0123", status: "open" },
          },
          { name: "main", site: true, this_studio: true },
        ],
      });
      // Read from GitHub, not from Val's history
      expect(asked.some((path) => path.startsWith("/history"))).toBe(false);
    });

    test("a project with no repository lists Val's own branches instead", async () => {
      const { deps } = depsOf({
        "/branches-api": {
          status: 409,
          body: {
            message: "This project has no GitHub repository.",
            details: { code: "no-repository" },
          },
        },
        "/proposals-api": listed,
        "/history/commits?branch=main&limit=1": commitsOf("abc", "Publish"),
        [`/history/commits?branch=val%2Fp%2F${OPEN}&limit=1`]: commitsOf(
          "def",
          "Save",
        ),
      });
      const answer = await runBranchTool("list_branches", {}, deps);
      expect(answer.result).toMatchObject({
        branches: [{ name: "main" }, { name: `val/p/${OPEN}` }],
        not_listed: expect.stringContaining("no GitHub repository"),
      });
    });

    test("an App the repository no longer has is the owners' to fix, and not retried", async () => {
      const { deps } = depsOf({
        "/branches-api": {
          status: 409,
          body: {
            message:
              "Val's GitHub App can no longer see acme/site. One of the GitHub organization's owners can install it again on the repository.",
            details: {
              code: "github-not-installed",
              reason: "Bad credentials",
            },
          },
        },
      });
      const answer = await runBranchTool("list_branches", {}, deps);
      expect(answer.isError).toBe(true);
      expect(answer.result).toMatchObject({
        error: expect.stringContaining("install it again"),
        code: "github-not-installed",
      });
      expect(answer.result).not.toHaveProperty("retry");
    });

    test("a branch's CI: where to see why, and what cannot be read yet", async () => {
      const { deps, asked } = depsOf({
        "/branches-api/checks?branch=feature%2Fhero": failingCi,
      });
      const answer = await runBranchTool(
        "check_build",
        { branch: "feature/hero" },
        deps,
      );
      expect(asked).toContain("/branches-api/checks?branch=feature%2Fhero");
      expect(answer.result).toMatchObject({
        branch: "feature/hero",
        ci: {
          state: "failure",
          checks: [{ url: "https://github.com/acme/site/runs/1" }],
          next: expect.stringContaining("url is where the person sees why"),
          missing_permissions: ["statuses"],
          missing_permissions_message: expect.stringContaining(
            "Commit statuses: read",
          ),
        },
      });
    });

    test("on the site, check_build reads the site's branch's CI", async () => {
      const { deps } = depsOf({
        "/branches-api/checks?branch=main": {
          status: 200,
          body: {
            ...failingCi.body,
            branch: "main",
            state: "success",
            checks: [],
            missingPermissions: [],
          },
        },
      });
      const answer = await runBranchTool("check_build", {}, deps);
      expect(answer.result).toMatchObject({ branch: "main", site: true });
    });

    test("a proposal's check carries its branch's CI", async () => {
      const { deps } = depsOf(
        {
          [`/proposals-api/${OPEN}`]: {
            status: 200,
            body: { proposal: proposal(OPEN) },
          },
          [`/proposals-api/${OPEN}/merge-checks`]: {
            status: 200,
            body: { canMerge: true, checks: [] },
          },
          [`/branches-api/checks?branch=val%2Fp%2F${OPEN}`]: failingCi,
        },
        { proposal: { name: OPEN, branch: `val/p/${OPEN}` } },
      );
      const answer = await runBranchTool("check_build", {}, deps);
      expect(answer.result).toMatchObject({
        can_publish: true,
        ci: { state: "failure" },
      });
    });
  });
});
