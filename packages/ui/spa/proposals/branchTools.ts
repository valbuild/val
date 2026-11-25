import type { AITool } from "../hooks/useAIWebSocket";
import type { CommitPage } from "../history/commitPage";
import type { BuildReport, CodeTypecheckStatus } from "./proposalCode";
import {
  ProposalsApiError,
  isSiteCode,
  jobState,
  meansNoProposals,
  type MergeCheckJson,
  type ProposalJson,
  type ProposalsClient,
} from "./proposalsClient";

/**
 * The assistant's tools for where its work lives: the branch this Studio is
 * on, the branch the site publishes to, the proposals (open and past) and
 * their branches, and whether a proposal's build and checks pass.
 *
 * All four only READ. What changes files is the code tools in a proposal
 * (`proposalCode.ts`), which is the one way the assistant changes code: the
 * site's files change when a proposal is published, never directly. There is
 * deliberately no tool here that pushes to a branch.
 *
 * Every answer is read through the function the Studio's own screens read it
 * through: the proposals client the proposal list and the Publish dialog use,
 * `/history/commits` as History reads it (`fetchCommitPage`), and the build
 * and typecheck state the code tools report.
 */

export const GET_BRANCH_CONTEXT_TOOL: AITool = {
  name: "get_branch_context",
  description:
    "Where this Studio's work goes: the branch it is on, the branch the site publishes to, and the proposal the work is in, if any. " +
    "Call it before talking about branches, proposals or publishing. Answers at once.",
  parameters: { type: "object", properties: {}, required: [] },
};

export const LIST_PROPOSALS_TOOL: AITool = {
  name: "list_proposals",
  description:
    "The project's proposals, newest first: open ones and earlier ones that were published (merged) or closed, " +
    "each with its name, branch, status and when it last changed. Use the name with check_build.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["open", "merged", "closed", "all"],
        description: "Which proposals to list (default all).",
      },
    },
    required: [],
  },
};

export const LIST_BRANCHES_TOOL: AITool = {
  name: "list_branches",
  description:
    "The branches Val works with: the site's, and each proposal's, with each branch's last commit (sha, message, when, by whom) and the proposal attached to it. " +
    "Branches made directly in the repository, outside Val, are not listed.",
  parameters: {
    type: "object",
    properties: {
      include_closed: {
        type: "boolean",
        description:
          "Also list the branches of proposals that were published or closed (default false).",
      },
    },
    required: [],
  },
};

export const CHECK_BUILD_TOOL: AITool = {
  name: "check_build",
  description:
    "Whether a proposal can be published: each of its checks (build, typecheck, lockfile, up to date with the site) with what clears a failing one, " +
    "its last build and typecheck, and -- for the proposal this Studio is in -- the build and typecheck running in this tab. " +
    "Defaults to the proposal this Studio is in.",
  parameters: {
    type: "object",
    properties: {
      proposal: {
        type: "string",
        description:
          "The proposal to check: its name, or its title as list_proposals gives it. Leave out for the one this Studio is in.",
      },
    },
    required: [],
  },
};

export const BRANCH_TOOLS: AITool[] = [
  GET_BRANCH_CONTEXT_TOOL,
  LIST_PROPOSALS_TOOL,
  LIST_BRANCHES_TOOL,
  CHECK_BUILD_TOOL,
];

const BRANCH_TOOL_NAMES = new Set(BRANCH_TOOLS.map((tool) => tool.name));
export function isBranchTool(name: string): boolean {
  return BRANCH_TOOL_NAMES.has(name);
}

/** What the assistant is told about these tools, and about pushing. */
export const BRANCH_TOOLS_PROMPT_SECTION = `

## Branches and proposals
get_branch_context says which branch this Studio is on, which branch the site publishes to, and which proposal the work is in. list_proposals lists the proposals, earlier ones too; list_branches lists Val's branches with their last commit; check_build says whether a proposal's build and checks pass, and what clears one that fails.
- Changes to code always go into a proposal, and reach the site's branch when the proposal is published. You cannot push to a branch directly, and nothing you do pushes to the site's branch. If the person asks you to push straight to a branch, say that Val does not do that, and offer to make the change in a proposal instead.
- When a check fails, tell the person what failed in their words and what clears it, as check_build says. Offer to do it when a tool of yours can (build_proposal, typecheck), and otherwise name the button.`;

/** What one of a branch's commits is, for the model. */
export type BranchCommit = {
  sha: string;
  message: string | null;
  at: string;
  by: string | null;
};

export type BranchToolDeps = {
  /** Which server this Studio talks to: `fs` has no branches. */
  mode: "http" | "fs" | "unknown";
  /** The proposal this Studio is in; `null` on the site. */
  proposal: { name: string; branch: string } | null;
  /** The branch the site publishes to (`siteBranch` on `/stat`). */
  siteBranch: string | null;
  client: Pick<ProposalsClient, "list" | "get" | "mergeChecks">;
  /** One page of a branch's commits: `fetchCommitPage`. */
  commits: (branch: string, limit: number) => Promise<CommitPage>;
  /** A person's name by profile id. */
  nameOf: (profileId: string) => string | null;
  /** The build of the proposal this Studio is in, as `build_status` reports it. */
  buildReport?: () => BuildReport;
  /** Its background typecheck, as `typecheck_status` reports it. */
  typecheckStatus?: () => Promise<CodeTypecheckStatus>;
};

export type BranchToolAnswer = { result: unknown; isError: boolean };

/** How many branches `list_branches` reads a last commit for. */
const MAX_BRANCHES = 25;
/** How many type errors `check_build` names. */
const MAX_TYPE_ERRORS = 10;

export const LOCAL_DEVELOPMENT =
  "This Studio runs in local development: content is read from and written to files on this computer, and Val has no branches or proposals here. " +
  "The branches are the project's git repository's: switch, commit and push them with git in the editor or a terminal. " +
  "Branches and proposals are in a Studio deployed with Val Build.";

const NOT_YET =
  "The Studio has not heard from Val's server yet, so it cannot tell where it is. Ask again in a moment.";

function refusal(error: string, extra: object = {}): BranchToolAnswer {
  return { result: { success: false, error, ...extra }, isError: true };
}

/**
 * A failed read of the proposals API, in words a person can act on. Content's
 * own message rides along under `details` for when they ask support.
 */
export function proposalsErrorAnswer(error: unknown): BranchToolAnswer {
  if (meansNoProposals(error)) {
    return refusal(
      "Proposals are not turned on for this project, so there are no proposal branches. One of the project's owners can turn them on in the project's settings in Val Build.",
    );
  }
  const details =
    error instanceof Error ? { details: error.message } : { details: null };
  if (error instanceof ProposalsApiError && error.status === 401) {
    return refusal(
      "The person is signed out of Val, or their session ran out. Ask them to sign in again (the Studio offers Sign in), then ask again.",
      details,
    );
  }
  if (error instanceof ProposalsApiError && error.status === 403) {
    return refusal(
      "The person is not allowed to see this project's proposals. The project's owners in Val Build can give them access.",
      details,
    );
  }
  return refusal(
    "Val Build could not be reached, so the proposals could not be read. Trying again in a moment can help.",
    { ...details, retry: true },
  );
}

export async function runBranchTool(
  name: string,
  args: unknown,
  deps: BranchToolDeps,
): Promise<BranchToolAnswer> {
  if (deps.mode === "fs") {
    if (name === GET_BRANCH_CONTEXT_TOOL.name) {
      return {
        result: { success: true, mode: "local", note: LOCAL_DEVELOPMENT },
        isError: false,
      };
    }
    return refusal(LOCAL_DEVELOPMENT);
  }
  if (deps.mode === "unknown") return refusal(NOT_YET, { retry: true });
  const input = typeof args === "object" && args !== null ? args : {};
  switch (name) {
    case GET_BRANCH_CONTEXT_TOOL.name:
      return branchContext(deps);
    case LIST_PROPOSALS_TOOL.name:
      return listProposals(
        "status" in input && typeof input.status === "string"
          ? input.status
          : "all",
        deps,
      );
    case LIST_BRANCHES_TOOL.name:
      return listBranches(
        "include_closed" in input && input.include_closed === true,
        deps,
      );
    case CHECK_BUILD_TOOL.name:
      return checkBuild(
        "proposal" in input && typeof input.proposal === "string"
          ? input.proposal
          : null,
        deps,
      );
  }
  return refusal(`No such tool: ${name}.`);
}

async function branchContext(deps: BranchToolDeps): Promise<BranchToolAnswer> {
  const here = deps.proposal;
  if (here === null) {
    return {
      result: {
        success: true,
        studio_branch: deps.siteBranch,
        site_branch: deps.siteBranch,
        proposal: null,
        note:
          deps.siteBranch === null
            ? "This Studio is on the site. Val's server does not name the site's branch."
            : "This Studio is on the site. Content published here goes to the site's branch; code changes go into a proposal.",
      },
      isError: false,
    };
  }
  // The title and status are a courtesy: where the Studio is is known
  // without them, so a failed read does not fail the answer.
  const proposal: ProposalJson | null = await deps.client
    .get(here.name)
    .catch(() => null);
  return {
    result: {
      success: true,
      studio_branch: here.branch,
      site_branch: deps.siteBranch,
      proposal: {
        name: here.name,
        branch: here.branch,
        ...(proposal !== null
          ? {
              title: titleOf(proposal),
              status: proposal.status,
              ...(proposal.git?.branchUrl
                ? { branch_url: proposal.git.branchUrl }
                : {}),
            }
          : {}),
      },
      note: `This Studio is in a proposal: changes go to its branch, ${here.branch}, and reach ${
        deps.siteBranch ?? "the site's branch"
      } when the proposal is published.`,
    },
    isError: false,
  };
}

function titleOf(proposal: ProposalJson): string {
  return isSiteCode(proposal) ? "The site's code" : proposal.displayName;
}

function statusOf(proposal: ProposalJson): "open" | "merged" | "closed" {
  return proposal.status === "merged" || proposal.status === "closed"
    ? proposal.status
    : "open";
}

async function readProposals(
  deps: BranchToolDeps,
): Promise<{ proposals: ProposalJson[] } | { error: unknown }> {
  try {
    const listed = await deps.client.list();
    return {
      proposals: [...listed.proposals].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    };
  } catch (error) {
    return { error };
  }
}

async function listProposals(
  status: string,
  deps: BranchToolDeps,
): Promise<BranchToolAnswer> {
  const read = await readProposals(deps);
  if ("error" in read) return proposalsErrorAnswer(read.error);
  const wanted = read.proposals.filter(
    (proposal) => status === "all" || statusOf(proposal) === status,
  );
  return {
    result: {
      success: true,
      proposals: wanted.map((proposal) => ({
        name: proposal.name,
        title: titleOf(proposal),
        branch: proposal.branch,
        status: proposal.status,
        updated_at: proposal.updatedAt,
        ...(proposal.changes !== undefined
          ? { changes: proposal.changes }
          : {}),
        ...(proposal.ownerId
          ? { owner: deps.nameOf(proposal.ownerId) ?? proposal.ownerId }
          : {}),
        ...(proposal.continuedIn ? { continued_in: proposal.continuedIn } : {}),
        ...(deps.proposal?.name === proposal.name ? { this_studio: true } : {}),
      })),
      ...(wanted.length === 0
        ? { note: "There are no proposals of that kind." }
        : {}),
    },
    isError: false,
  };
}

async function lastCommitOf(
  branch: string,
  deps: BranchToolDeps,
): Promise<{ last_commit: BranchCommit | null; last_commit_error?: string }> {
  const page = await deps.commits(branch, 1);
  if (page.status === "error") {
    return { last_commit: null, last_commit_error: page.message };
  }
  const commit = page.commits[0];
  if (commit === undefined) return { last_commit: null };
  return {
    last_commit: {
      sha: commit.commitSha,
      message: commit.message,
      at: commit.createdAt,
      by:
        commit.creator === null
          ? null
          : (deps.nameOf(commit.creator) ?? commit.creator),
    },
  };
}

async function listBranches(
  includeClosed: boolean,
  deps: BranchToolDeps,
): Promise<BranchToolAnswer> {
  const read = await readProposals(deps);
  // A project without proposals still has the site's branch to list.
  const noProposals = "error" in read && meansNoProposals(read.error);
  if ("error" in read && !noProposals) return proposalsErrorAnswer(read.error);
  const proposals = "error" in read ? [] : read.proposals;
  const listed = proposals.filter(
    (proposal) => includeClosed || statusOf(proposal) === "open",
  );
  const rows: Array<{
    branch: string;
    proposal: ProposalJson | null;
  }> = [
    ...(deps.siteBranch !== null
      ? [{ branch: deps.siteBranch, proposal: null }]
      : []),
    ...listed.map((proposal) => ({ branch: proposal.branch, proposal })),
  ];
  const shown = rows.slice(0, MAX_BRANCHES);
  const branches = await Promise.all(
    shown.map(async (row) => ({
      name: row.branch,
      ...(row.proposal === null
        ? { site: true, proposal: null }
        : {
            proposal: {
              name: row.proposal.name,
              title: titleOf(row.proposal),
              status: row.proposal.status,
            },
          }),
      ...(row.branch === (deps.proposal?.branch ?? deps.siteBranch)
        ? { this_studio: true }
        : {}),
      ...(await lastCommitOf(row.branch, deps)),
    })),
  );
  return {
    result: {
      success: true,
      branches,
      ...(rows.length > shown.length
        ? {
            more: `${rows.length - shown.length} more proposal branches are not listed: list_proposals lists every proposal.`,
          }
        : {}),
      ...(deps.siteBranch === null
        ? { site_branch: "Val's server does not name the site's branch." }
        : {}),
      ...(noProposals ? { proposals: "Proposals are not turned on." } : {}),
      not_listed:
        "Branches made directly in the repository, outside Val, are not listed: Val reads only the site's branch and its proposals' branches.",
    },
    isError: false,
  };
}

/** What clears a failing check, in the words of the Publish dialog. */
function nextFor(check: MergeCheckJson, here: boolean): string | undefined {
  switch (check.action) {
    case "update-from-site":
      return "The site changed since the proposal started: press Update from the site beside this check in the proposal's Publish dialog.";
    case "compute-lockfile":
      return "Press Compute lockfile beside this check in the proposal's Publish dialog.";
    case "typecheck":
      return here
        ? "Call typecheck, or press the button beside this check in the Publish dialog."
        : "Open the proposal and run its typecheck from the Publish dialog.";
    case "build":
      return here
        ? "Call build_proposal, or press Build beside this check in the Publish dialog."
        : "Open the proposal and press Build beside this check in its Publish dialog.";
    case undefined:
      return undefined;
  }
}

async function resolveProposal(
  wanted: string | null,
  deps: BranchToolDeps,
): Promise<{ name: string } | { answer: BranchToolAnswer }> {
  if (wanted === null) {
    if (deps.proposal !== null) return { name: deps.proposal.name };
    return {
      answer: refusal(
        "This Studio is on the site, not in a proposal, and Val cannot read the site's own build or CI checks: the host that deploys the site shows them. Name a proposal (list_proposals) to check its build.",
      ),
    };
  }
  if (/^[0-9a-f]{20}$/.test(wanted)) return { name: wanted };
  const read = await readProposals(deps);
  if ("error" in read) return { answer: proposalsErrorAnswer(read.error) };
  const lower = wanted.trim().toLowerCase();
  const matches = read.proposals.filter(
    (proposal) =>
      proposal.displayName.toLowerCase() === lower ||
      proposal.branch === wanted,
  );
  if (matches.length === 1 && matches[0] !== undefined) {
    return { name: matches[0].name };
  }
  return {
    answer: refusal(
      matches.length === 0
        ? `No proposal is called "${wanted}". list_proposals lists them by name and title.`
        : `More than one proposal is called "${wanted}": name it by its name from list_proposals.`,
    ),
  };
}

async function checkBuild(
  wanted: string | null,
  deps: BranchToolDeps,
): Promise<BranchToolAnswer> {
  const resolved = await resolveProposal(wanted, deps);
  if ("answer" in resolved) return resolved.answer;
  const name = resolved.name;
  const here = deps.proposal?.name === name;
  let proposal: ProposalJson;
  try {
    proposal = await deps.client.get(name);
  } catch (error) {
    if (error instanceof ProposalsApiError && error.status === 404) {
      return refusal(
        `No proposal is called "${name}". list_proposals lists them.`,
      );
    }
    return proposalsErrorAnswer(error);
  }
  const about = {
    name: proposal.name,
    title: titleOf(proposal),
    branch: proposal.branch,
    status: proposal.status,
  };
  if (statusOf(proposal) !== "open") {
    return {
      result: {
        success: true,
        proposal: about,
        note: `This proposal was ${proposal.status === "merged" ? "published" : "closed"}: there is nothing left to build or check.`,
      },
      isError: false,
    };
  }
  const setup = jobState(proposal.setup);
  const typecheck = proposal.typecheck ?? null;
  const result: Record<string, unknown> = {
    success: true,
    proposal: about,
    ...(setup !== null && setup.status === "failed"
      ? {
          setup: {
            status: "failed",
            error: setup.error,
            next: "The proposal could not be set up. It can be tried again from the proposals list; if it fails the same way, Val support can see why.",
          },
        }
      : {}),
    last_build:
      proposal.serverBuild?.state === "failed"
        ? {
            status: "failed",
            error: proposal.serverBuild.error,
            next: here
              ? "Fix what the error names, then call build_proposal again."
              : "Open the proposal to fix what the error names, then build it again.",
          }
        : proposal.serverBuild?.state === "pending"
          ? { status: "building" }
          : proposal.built
            ? { status: "built" }
            : { status: "none" },
    typecheck:
      typecheck === null
        ? null
        : {
            errors: typecheck.errors.length,
            new_errors: typecheck.newErrors,
            checked_at: typecheck.checkedAt,
            first: typecheck.errors.slice(0, MAX_TYPE_ERRORS),
          },
  };
  if (here && deps.buildReport !== undefined) {
    result.build_in_this_tab = deps.buildReport();
  }
  if (here && deps.typecheckStatus !== undefined) {
    try {
      result.typecheck_in_this_tab = await deps.typecheckStatus();
    } catch {
      // Beside the point when content answered; the rest still stands.
    }
  }
  try {
    const checks = await deps.client.mergeChecks(name);
    result.can_publish = checks.canMerge;
    result.checks = checks.checks.map((check) => {
      const next = check.ok ? undefined : nextFor(check, here);
      return {
        ok: check.ok,
        message: check.message,
        ...(next !== undefined ? { next } : {}),
      };
    });
  } catch (error) {
    const failed = proposalsErrorAnswer(error).result;
    result.checks = null;
    result.checks_error = failed;
  }
  return { result, isError: false };
}
