import { createValClient } from "@valbuild/shared/internal";
import { fetchCommitPage } from "../history/commitPage";
import {
  BRANCH_TOOLS,
  LOCAL_DEVELOPMENT,
  runBranchTool,
  type BranchToolDeps,
} from "./branchTools";
import { createProposalsClient, type ProposalJson } from "./proposalsClient";

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
    const found = routes[path] ?? {
      status: 500,
      body: { message: `no route ${path}` },
    };
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

  test("on the site, check_build says where the site's checks are instead", async () => {
    const answer = await runBranchTool("check_build", {}, depsOf({}).deps);
    expect(answer.isError).toBe(true);
    expect(JSON.stringify(answer.result)).toContain(
      "the host that deploys the site shows them",
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
});
