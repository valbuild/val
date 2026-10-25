import type {
  TypeErrorEntry,
  TypecheckResult,
} from "@valbuild/shared/typecheck";
import {
  MAX_REPORTED_ERRORS,
  errorsByFile,
  runProposalTypecheck,
  type ProposalTypecheckDeps,
} from "./proposalTypecheck";
import type { ProposalStaged } from "./proposalsClient";

/*
 * valbuild/home `docs/adept.md`, decision 20: an upgrade is judged by the
 * type errors it ADDS. The site's code with its lockfile is the base, the
 * proposal's code with its own the upgrade, and only what the base does not
 * have is reported.
 */

const error = (file: string, message: string, line = 1): TypeErrorEntry => ({
  file,
  line,
  column: 1,
  code: 2322,
  message,
  tsconfig: "tsconfig.json",
});

const result = (errors: TypeErrorEntry[]): TypecheckResult => ({
  errors,
  programs: [],
  typescript: { version: "5.9.3", wanted: "5.9.3", reason: "project" },
  bundles: {
    scanned: 0,
    resolved: 0,
    files: 0,
    stubs: 0,
    bytes: 0,
    count: 0,
    rounds: 0,
  },
  missing: [],
  timings: {
    layoutMs: 0,
    compilerMs: 0,
    typesMs: 0,
    checkMs: 0,
    totalMs: 0,
  },
});

const staged = (inputs: string | null): ProposalStaged => ({
  files: inputs === null ? [] : ["pnpm-lock.yaml", "package.json"],
  inputs,
  buildRequired: false,
});

function deps(over: Partial<ProposalTypecheckDeps> = {}) {
  const checked: { lockfile: string; files: string[] }[] = [];
  const reported: unknown[] = [];
  const base: ProposalTypecheckDeps = {
    name: "p1",
    client: {
      files: async () => ({
        files: {
          "package.json": '{"dependencies":{"zod":"4"}}',
          "pnpm-lock.yaml": "proposal lock",
        },
        staged: staged("inputs-1"),
      }),
      reportTypecheck: async (_name, report) => {
        reported.push(report);
        return {
          inputs: report.inputs,
          newErrors: report.count ?? report.newErrors.length,
          errors: report.newErrors,
          checkedAt: "now",
        };
      },
    },
    siteSource: async () => ({
      "package.json": '{"dependencies":{"zod":"3"}}',
      "src/a.ts": "export const a = 1;",
    }),
    siteDependencyFiles: async () => ({ "pnpm-lock.yaml": "site lock" }),
    computeLockfile: async () => {
      throw new Error("not asked for here");
    },
    check: async (input) => {
      checked.push({
        lockfile: input.lockfile,
        files: Object.keys(input.files).sort(),
      });
      return input.lockfile === "site lock" || input.lockfile === "computed"
        ? result([error("src/a.ts", "old")])
        : result([error("src/a.ts", "old"), error("src/b.ts", "new")]);
    },
    signal: new AbortController().signal,
    ...over,
  };
  return { deps: base, checked, reported };
}

describe("a proposal's typecheck", () => {
  test("the site with its lockfile, then the proposal with its own: only the new errors are reported", async () => {
    const { deps: d, checked, reported } = deps();
    const outcome = await runProposalTypecheck(d);
    expect(checked).toEqual([
      { lockfile: "site lock", files: ["package.json", "src/a.ts"] },
      // The lockfile is the check's, not one of the project's files.
      { lockfile: "proposal lock", files: ["package.json", "src/a.ts"] },
    ]);
    expect(reported).toEqual([
      {
        inputs: "inputs-1",
        newErrors: [
          { file: "src/b.ts", line: 1, column: 1, code: 2322, message: "new" },
        ],
      },
    ]);
    expect(outcome).toMatchObject({ status: "checked", inputs: "inputs-1" });
  });

  test("a site with no lockfile on record is checked against one computed from its package.json", async () => {
    const asked: string[] = [];
    const { deps: d, checked } = deps({
      siteDependencyFiles: async () => ({}),
      computeLockfile: async (packageJson) => {
        asked.push(packageJson);
        return "computed";
      },
    });
    await runProposalTypecheck(d);
    expect(asked).toEqual(['{"dependencies":{"zod":"3"}}']);
    expect(checked[0]?.lockfile).toBe("computed");
  });

  test("nothing staged is nothing to check, and nothing is reported", async () => {
    const {
      deps: d,
      checked,
      reported,
    } = deps({
      client: {
        files: async () => ({ files: {}, staged: staged(null) }),
        reportTypecheck: async () => {
          throw new Error("nothing to report");
        },
      },
    });
    expect(await runProposalTypecheck(d)).toEqual({
      status: "nothing-staged",
    });
    expect(checked).toEqual([]);
    expect(reported).toEqual([]);
  });

  test("at most a few hundred errors are sent, with how many there were", async () => {
    const many = Array.from({ length: MAX_REPORTED_ERRORS + 5 }, (_, at) =>
      error(`src/f${at}.ts`, "new"),
    );
    const { deps: d, reported } = deps({
      check: async (input) =>
        result(input.lockfile === "site lock" ? [] : many),
    });
    const outcome = await runProposalTypecheck(d);
    expect(reported).toEqual([
      expect.objectContaining({ count: MAX_REPORTED_ERRORS + 5 }),
    ]);
    const sent = reported[0];
    if (typeof sent !== "object" || sent === null || !("newErrors" in sent))
      throw new Error("no report");
    expect(Array.isArray(sent.newErrors) && sent.newErrors.length).toBe(
      MAX_REPORTED_ERRORS,
    );
    // The page keeps them all.
    expect(outcome.status === "checked" && outcome.errors.length).toBe(
      MAX_REPORTED_ERRORS + 5,
    );
  });

  test("errors are listed by file, each file's in the order found", () => {
    expect(
      errorsByFile([
        { file: "b.ts", line: 2, column: 1, code: 1, message: "x" },
        { file: "a.ts", line: 9, column: 1, code: 1, message: "y" },
        { file: "b.ts", line: 1, column: 1, code: 1, message: "z" },
      ]).map(([file, errors]) => [file, errors.map((e) => e.message)]),
    ).toEqual([
      ["a.ts", ["y"]],
      ["b.ts", ["x", "z"]],
    ]);
  });
});
