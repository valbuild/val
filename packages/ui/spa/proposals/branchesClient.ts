import { z } from "zod";
import type { ValClient } from "@valbuild/shared/internal";

/**
 * A connected project's GitHub branches, and a branch's CI, as content reads
 * them with the project's installation (valbuild/home `handlers/branches.ts`,
 * `Api["/branches"]` and `Api["/branches/checks"]`), through this
 * deployment's `/branches-api`. What the assistant's `list_branches` and
 * `check_build` read (`branchTools.ts`).
 */

const GitHubBranch = z.object({
  name: z.string(),
  sha: z.string(),
  message: z.string().nullable(),
  committedAt: z.string().nullable(),
  author: z.string().nullable(),
  proposal: z.string().nullable(),
  isSiteBranch: z.boolean(),
});
export type GitHubBranch = z.infer<typeof GitHubBranch>;

const BranchesAnswer = z.object({
  repository: z.object({
    owner: z.string(),
    repo: z.string(),
    url: z.string(),
  }),
  siteBranch: z.string(),
  total: z.number(),
  branches: z.array(GitHubBranch),
});
export type GitHubBranches = z.infer<typeof BranchesAnswer>;

const BranchCheck = z.object({
  name: z.string(),
  source: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  url: z.string().nullable(),
  summary: z.string().nullable(),
});

const ChecksAnswer = z.object({
  branch: z.string(),
  sha: z.string(),
  state: z.enum(["success", "failure", "pending", "none"]),
  checks: z.array(BranchCheck),
  missingPermissions: z.array(z.string()),
  missingPermissionsMessage: z.string().optional(),
});
export type GitHubBranchChecks = z.infer<typeof ChecksAnswer>;

const Refusal = z.object({
  message: z.string().optional(),
  details: z.object({ code: z.string() }).passthrough().optional(),
});

/**
 * Why there is no answer. `code` is content's (`no-repository`,
 * `github-not-installed`, `github-unreachable`, `branch-not-found`), or
 * this side's: `signed-out`, `not-supported` (a server or content too old
 * to know the route, or a server with no content service), `unreadable`.
 */
export type BranchesRefusal = {
  code: string;
  message: string;
  httpStatus: number | null;
};

export type BranchesAnswer<T> =
  | { status: "ok"; value: T }
  | { status: "refused"; refusal: BranchesRefusal };

export type BranchesClient = {
  list(): Promise<BranchesAnswer<GitHubBranches>>;
  checks(branch: string): Promise<BranchesAnswer<GitHubBranchChecks>>;
};

export function createBranchesClient(client: ValClient): BranchesClient {
  async function ask<T>(
    path: "" | "/checks",
    branch: string | undefined,
    parse: z.ZodType<T>,
  ): Promise<BranchesAnswer<T>> {
    let failure: unknown = null;
    const res = await client("/branches-api", "GET", {
      path,
      query: { branch },
    }).catch((error: unknown) => {
      failure = error;
      return null;
    });
    if (res === null) {
      return refused(
        "unreachable",
        `Val's server could not be reached (${failure instanceof Error ? failure.message : String(failure)}). Trying again in a moment can help.`,
        null,
      );
    }
    // Content's status and body, carried unread (`/branches-api`).
    if (res.status === 200) {
      const parsed = parse.safeParse(res.json);
      if (parsed.success) return { status: "ok", value: parsed.data };
      return refused(
        "unreadable",
        "Val Build answered in a shape this Studio does not read. Reloading the Studio can help after an update.",
        res.status,
      );
    }
    const refusal = Refusal.safeParse(res.json);
    const code = refusal.success ? refusal.data.details?.code : undefined;
    const message = refusal.success ? refusal.data.message : undefined;
    if (code !== undefined && message !== undefined) {
      return refused(code, message, res.status);
    }
    if (res.status === 401) {
      return refused(
        "signed-out",
        "The person is signed out of Val, or their session ran out. Ask them to sign in again (the Studio offers Sign in), then ask again.",
        401,
      );
    }
    if (res.status === 403) {
      return refused(
        "not-allowed",
        "The person is not allowed to read this project's branches. The project's owners in Val Build can give them access.",
        403,
      );
    }
    if (res.status === 404 || res.status === 501 || res.status === null) {
      return refused(
        "not-supported",
        "Val Build does not read this project's GitHub branches yet.",
        res.status,
      );
    }
    return refused(
      "github-unreachable",
      "Val Build could not read the branches. Trying again in a moment can help.",
      res.status,
    );
  }
  return {
    list: () => ask("", undefined, BranchesAnswer),
    checks: (branch) => ask("/checks", branch, ChecksAnswer),
  };
}

function refused<T>(
  code: string,
  message: string,
  httpStatus: number | null,
): BranchesAnswer<T> {
  return { status: "refused", refusal: { code, message, httpStatus } };
}
