import {
  type TypeErrorEntry,
  type TypecheckProgress,
  type TypecheckResult,
  newErrors,
} from "@valbuild/shared/typecheck";
import { proposalProject } from "./proposalCode";
import type {
  ProposalTypeError,
  ProposalTypecheck,
  ProposalsClient,
} from "./proposalsClient";

/*
 * The typecheck of a proposal whose dependencies are its own (valbuild/home
 * `docs/adept.md`, decision 20): the site's code with the site's lockfile --
 * the base -- and the proposal's code with its lockfile, each checked as it
 * would be after `pnpm install`, in the browser. Only the errors the base
 * does not have count, and content is told them: a proposal with dependencies
 * of its own is not published until a typecheck of what it stages has none.
 */

/** At most this many of the new errors are sent; the count says how many. */
export const MAX_REPORTED_ERRORS = 200;

/** What the typecheck is doing, as it says so. */
export type ProposalTypecheckStep =
  | { step: "reading" }
  | { step: "lockfile" }
  | { step: "checking"; which: "site" | "proposal"; detail: string };

export type ProposalTypecheckDeps = {
  name: string;
  client: Pick<ProposalsClient, "files" | "reportTypecheck">;
  /** The site's code, as its live build has it; `null` when nothing is live. */
  siteSource: () => Promise<Record<string, string> | null>;
  /** The site's recorded `pnpm-lock.yaml` and `pnpm-workspace.yaml`. */
  siteDependencyFiles: () => Promise<Record<string, string>>;
  /** A lockfile for `packageJson`, for a site that has none on record. */
  computeLockfile: (
    packageJson: string,
    signal: AbortSignal,
  ) => Promise<string>;
  check: (
    input: {
      files: Record<string, string>;
      lockfile: string;
      workspace: string | null;
    },
    options: {
      onProgress: (progress: TypecheckProgress) => void;
      signal: AbortSignal;
    },
  ) => Promise<TypecheckResult>;
  onStep?: (step: ProposalTypecheckStep) => void;
  signal: AbortSignal;
};

export type ProposalTypecheckOutcome =
  /** Nothing staged: there is nothing of the proposal's to check. */
  | { status: "nothing-staged" }
  | {
      status: "checked";
      inputs: string;
      /** Every new error, not only the ones sent. */
      errors: ProposalTypeError[];
      typecheck: ProposalTypecheck;
    };

const LOCKFILE = "pnpm-lock.yaml";
const WORKSPACE = "pnpm-workspace.yaml";

/** A type error as content keeps it: a file always, a position always. */
export function reportedError(error: TypeErrorEntry): ProposalTypeError {
  return {
    file: error.file ?? `(${error.tsconfig})`,
    line: error.line ?? 0,
    column: error.column ?? 0,
    code: error.code,
    message: error.message,
  };
}

function describe(progress: TypecheckProgress): string {
  switch (progress.step) {
    case "layout":
      return "Laying out node_modules";
    case "compiler":
      return `Loading TypeScript ${progress.version}`;
    case "types":
      return `Loading types (${progress.fetched})`;
    case "check":
      return `Checking ${progress.tsconfig}`;
  }
}

export async function runProposalTypecheck(
  deps: ProposalTypecheckDeps,
): Promise<ProposalTypecheckOutcome> {
  deps.onStep?.({ step: "reading" });
  const read = await deps.client.files(deps.name);
  const inputs = read.staged.inputs;
  if (inputs === null) return { status: "nothing-staged" };
  const site = (await deps.siteSource()) ?? {};
  const recorded = await deps.siteDependencyFiles();
  let baseLockfile = recorded[LOCKFILE] ?? site[LOCKFILE] ?? null;
  if (baseLockfile === null) {
    // A site made before proposals carried dependencies has no lockfile on
    // record: the base is checked against one computed from its package.json,
    // as `pnpm install` would make it.
    const packageJson = site["package.json"];
    if (packageJson === undefined) {
      throw new Error(
        "The site has no package.json, so there is nothing to check the proposal against.",
      );
    }
    deps.onStep?.({ step: "lockfile" });
    baseLockfile = await deps.computeLockfile(packageJson, deps.signal);
  }
  const baseWorkspace = recorded[WORKSPACE] ?? site[WORKSPACE] ?? null;
  const withoutLockfile = (files: Record<string, string>) => {
    const out = { ...files };
    delete out[LOCKFILE];
    return out;
  };

  const project = proposalProject(site, read.files);
  const checkOne = (
    which: "site" | "proposal",
    files: Record<string, string>,
    lockfile: string,
    workspace: string | null,
  ) =>
    deps.check(
      { files: withoutLockfile(files), lockfile, workspace },
      {
        signal: deps.signal,
        onProgress: (progress) =>
          deps.onStep?.({
            step: "checking",
            which,
            detail: describe(progress),
          }),
      },
    );
  // One after the other: the worker that loaded the compiler for the first
  // reuses it for the second.
  const base = await checkOne("site", site, baseLockfile, baseWorkspace);
  const next = await checkOne(
    "proposal",
    project,
    project[LOCKFILE] ?? baseLockfile,
    project[WORKSPACE] ?? baseWorkspace,
  );
  const errors = newErrors(base.errors, next.errors).map(reportedError);
  const typecheck = await deps.client.reportTypecheck(deps.name, {
    inputs,
    newErrors: errors.slice(0, MAX_REPORTED_ERRORS),
    ...(errors.length > MAX_REPORTED_ERRORS ? { count: errors.length } : {}),
  });
  return { status: "checked", inputs, errors, typecheck };
}

/** New errors by file, each file's in order: how the dialog lists them. */
export function errorsByFile(
  errors: ProposalTypeError[],
): [string, ProposalTypeError[]][] {
  const files = new Map<string, ProposalTypeError[]>();
  for (const error of errors) {
    let list = files.get(error.file);
    if (!list) files.set(error.file, (list = []));
    list.push(error);
  }
  return [...files].sort(([a], [b]) => a.localeCompare(b));
}
