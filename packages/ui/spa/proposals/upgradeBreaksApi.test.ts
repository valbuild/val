import * as fs from "node:fs";
import * as path from "node:path";
import {
  type TypecheckSources,
  type TypesBundle,
  typecheckProject,
  runProposalTypecheck,
} from "@valbuild/shared/typecheck";
import { nodeModulesSources } from "@valbuild/shared/typecheck/testing";
import type { ProposalsClient } from "./proposalsClient";

type Report = Parameters<ProposalsClient["reportTypecheck"]>[1];

/*
 * What an upgrade's typecheck is for: a dependency that removes a function,
 * or changes what one takes, breaks the site's code at the line that uses it
 * -- and the check, run as an upgrade proposal runs it (the site on its
 * lockfile, then the proposal on its own), reports exactly that line as new.
 *
 * The real `typecheckProject`, on template-tanstack-minimal's real lockfile.
 * zod is the dependency that moves, 4.6.5 to 4.7.0, and its bundles are
 * written here, so the API that changes is the one the test says changed.
 */
const REPO = path.resolve(__dirname, "../../../..");
const siteLockfile = fs.readFileSync(
  path.join(
    __dirname,
    "../../../shared/src/typecheck/fixtures/template-tanstack-minimal/pnpm-lock.yaml",
  ),
  "utf8",
);
// Every 4.6.5 in that lockfile is zod's.
const upgradedLockfile = siteLockfile.replaceAll("4.6.5", "4.7.0");

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    lib: ["ES2022"],
    module: "ESNext",
    moduleResolution: "bundler",
    types: [],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  },
  include: ["src"],
});

const site: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "site",
    private: true,
    dependencies: { zod: "^4.4.3" },
  }),
  "tsconfig.json": tsconfig,
  "src/slug.ts": `import { slugify, trim } from "zod";

export function slug(title: string): string {
  return slugify(trim(title));
}
`,
};

const zodBundle = (version: string, declarations: string): TypesBundle => ({
  files: {
    "package.json": JSON.stringify({
      name: "zod",
      version,
      types: "index.d.ts",
    }),
    "index.d.ts": declarations,
  },
  stubs: [],
});

function sourcesWithZod(versions: Record<string, string>): TypecheckSources {
  const repo = nodeModulesSources(REPO, { anyVersion: true });
  return {
    types: async (pkg) => {
      if (pkg.name !== "zod") return repo.types(pkg);
      const declarations = versions[pkg.version];
      if (declarations === undefined) {
        throw new Error(`No zod ${pkg.version} in this test`);
      }
      return zodBundle(pkg.version, declarations);
    },
    compiler: (version) => repo.compiler(version),
  };
}

const BEFORE = `export declare function slugify(s: string): string;
export declare function trim(s: string): string;
export declare function words(s: string): string[];
`;

async function upgradeTo(after: string) {
  const sources = sourcesWithZod({ "4.6.5": BEFORE, "4.7.0": after });
  const reports: Report[] = [];
  const outcome = await runProposalTypecheck({
    name: "upgrade",
    client: {
      files: async () => ({
        files: {
          "package.json": site["package.json"]!,
          "pnpm-lock.yaml": upgradedLockfile,
        },
        staged: {
          files: ["pnpm-lock.yaml"],
          inputs: "inputs-1",
          buildRequired: false,
        },
      }),
      reportTypecheck: async (_name, report) => {
        reports.push(report);
        return {
          inputs: report.inputs,
          newErrors: report.count ?? report.newErrors.length,
          errors: report.newErrors,
          checkedAt: "now",
        };
      },
    },
    siteSource: async () => site,
    siteDependencyFiles: async () => ({ "pnpm-lock.yaml": siteLockfile }),
    computeLockfile: async () => {
      throw new Error("The site's lockfile is on record");
    },
    check: (input, options) =>
      typecheckProject({
        ...input,
        sources,
        onProgress: options.onProgress,
      }),
    signal: new AbortController().signal,
  });
  if (outcome.status !== "checked") throw new Error(outcome.status);
  return { errors: outcome.errors, reports };
}

describe("an upgrade that breaks the site's code", () => {
  test("a removed export is a new error, at the import that names it", async () => {
    const { errors, reports } = await upgradeTo(
      `export declare function trim(s: string): string;
export declare function words(s: string): string[];
`,
    );
    expect(errors).toEqual([
      {
        file: "src/slug.ts",
        line: 1,
        column: 10,
        code: 2305,
        message: `Module '"zod"' has no exported member 'slugify'.`,
      },
    ]);
    // And it is what content is told, so the proposal is not published.
    expect(reports).toEqual([{ inputs: "inputs-1", newErrors: errors }]);
  });

  test("a changed signature is a new error, at the call that no longer fits", async () => {
    const { errors } = await upgradeTo(
      `export declare function slugify(s: string): string;
export declare function trim(s: string, chars: string): string;
export declare function words(s: string): string[];
`,
    );
    expect(errors).toEqual([
      {
        file: "src/slug.ts",
        line: 4,
        column: 18,
        code: 2554,
        message: "Expected 2 arguments, but got 1.",
      },
    ]);
  });

  test("removing an export the site does not use reports nothing", async () => {
    const { errors, reports } = await upgradeTo(
      `export declare function slugify(s: string): string;
export declare function trim(s: string): string;
`,
    );
    expect(errors).toEqual([]);
    expect(reports).toEqual([{ inputs: "inputs-1", newErrors: [] }]);
  });
});
