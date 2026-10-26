import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { adeptSources } from "../adeptSources";
import { typecheckProject, type TypeErrorEntry } from "../typecheckProject";
import { nodeModulesSources } from "./nodeModulesSources";

/**
 * Typechecks a checkout the way the Studio does, and compares the result
 * with `tsc --noEmit` on the same checkout after `pnpm install`:
 *
 *     pnpm exec tsx packages/shared/src/typecheck/testing/typecheckParity.ts \
 *       <installed checkout> [--adept http://127.0.0.1:4300/v1] [--json out.json]
 *
 * With `--adept`, bundles and the compiler come from that adept (the
 * Studio's own source, minus the proxy); without it, they are cut from the
 * checkout's own `node_modules` as adept cuts them from tarballs. The files
 * given to the checker are the ones the platform stores for a project
 * (`isStoredSource` in valbuild/home): code and JSON, outside dot
 * directories, `node_modules` and `dist`.
 *
 * Exits 0 when both report the same errors.
 */

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/;
const LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json"]);
const SKIPPED_DIRS = new Set(["node_modules", "dist"]);

function storedSource(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), {
      withFileTypes: true,
    })) {
      const relative = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIPPED_DIRS.has(entry.name)) {
          walk(relative);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const json = entry.name.endsWith(".json") && !LOCKFILES.has(entry.name);
      if (CODE_FILE.test(entry.name) || json) {
        files[relative] = fs.readFileSync(path.join(root, relative), "utf8");
      }
    }
  };
  walk("");
  return files;
}

type Located = Pick<TypeErrorEntry, "file" | "line" | "column" | "code"> & {
  message: string;
};

/** `tsc --pretty false`'s `file(line,col): error TSn: message` lines. */
function runTsc(root: string): Located[] {
  let output: string;
  try {
    output = execFileSync(
      path.join(root, "node_modules", ".bin", "tsc"),
      ["--noEmit", "--pretty", "false", "-p", root],
      { cwd: root, encoding: "utf8" },
    );
  } catch (error) {
    const stdout =
      typeof error === "object" && error !== null && "stdout" in error
        ? error.stdout
        : "";
    output = typeof stdout === "string" ? stdout : "";
  }
  const errors: Located[] = [];
  for (const line of output.split("\n")) {
    const located = /^(.+)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
    if (located) {
      errors.push({
        file: located[1]!,
        line: Number(located[2]),
        column: Number(located[3]),
        code: Number(located[4]),
        message: located[5]!,
      });
      continue;
    }
    const global = /^error TS(\d+): (.*)$/.exec(line);
    if (global) {
      errors.push({
        file: null,
        line: null,
        column: null,
        code: Number(global[1]),
        message: global[2]!,
      });
    }
  }
  return errors;
}

/** The root tsconfig's program, as `tsc --listFiles` prints it, relative to `root`. */
function listTscFiles(root: string): string[] {
  let output: string;
  try {
    output = execFileSync(
      path.join(root, "node_modules", ".bin", "tsc"),
      ["--noEmit", "--listFiles", "--pretty", "false", "-p", root],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    const stdout =
      typeof error === "object" && error !== null && "stdout" in error
        ? error.stdout
        : "";
    output = typeof stdout === "string" ? stdout : "";
  }
  return output
    .split("\n")
    .filter((line) => line.startsWith("/"))
    .map((line) => {
      const file = fs.realpathSync(line);
      return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
    });
}

const keyOf = (e: Located) =>
  `${e.file ?? ""}:${e.line ?? ""}:${e.column ?? ""} TS${e.code} ${e.message.split("\n")[0]}`;

async function main() {
  const args = process.argv.slice(2);
  const root = path.resolve(args[0] ?? ".");
  const flag = (name: string) => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  const adept = flag("--adept");
  const jsonOut = flag("--json");
  const files = storedSource(root);
  const lockfile = fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
  const workspacePath = path.join(root, "pnpm-workspace.yaml");
  const workspace = fs.existsSync(workspacePath)
    ? fs.readFileSync(workspacePath, "utf8")
    : null;
  const sources = adept
    ? adeptSources({ base: adept })
    : nodeModulesSources(root);
  const result = await typecheckProject({
    files,
    lockfile,
    workspace,
    sources,
    listFiles: true,
  });
  const tsc = runTsc(root);
  /*
   * The same errors could come from different programs. Comparing the files
   * each program holds with `tsc --listFiles` shows that the types fetched
   * are the ones an install would have given it, no more and no fewer.
   * TypeScript's own libs are under another root on each side, so they are
   * compared by name.
   */
  const libName = (file: string) =>
    /\/lib\.[^/]*\.d\.ts$|\/lib\.d\.ts$/.test(file)
      ? `lib:${file.slice(file.lastIndexOf("/") + 1)}`
      : file;
  const ourFiles = new Set(
    (
      result.programs.find((p) => p.tsconfig === "tsconfig.json")?.fileNames ??
      []
    ).map(libName),
  );
  const tscFiles = new Set(listTscFiles(root).map(libName));
  const filesOnlyOurs = [...ourFiles].filter((f) => !tscFiles.has(f));
  const filesOnlyTsc = [...tscFiles].filter((f) => !ourFiles.has(f));
  const ours = new Set(result.errors.map(keyOf));
  const theirs = new Set(tsc.map(keyOf));
  const onlyOurs = [...ours].filter((key) => !theirs.has(key));
  const onlyTsc = [...theirs].filter((key) => !ours.has(key));
  const summary = {
    project: root,
    source: adept ?? "node_modules",
    files: Object.keys(files).length,
    typescript: result.typescript,
    errors: result.errors.length,
    tscErrors: tsc.length,
    same:
      onlyOurs.length === 0 &&
      onlyTsc.length === 0 &&
      filesOnlyOurs.length === 0 &&
      filesOnlyTsc.length === 0,
    onlyOurs,
    onlyTsc,
    programFiles: { ours: ourFiles.size, tsc: tscFiles.size },
    filesOnlyOurs,
    filesOnlyTsc,
    programs: result.programs.map(({ fileNames: _, ...program }) => program),
    bundles: result.bundles,
    missing: result.missing,
    timings: result.timings,
  };
  console.log(JSON.stringify(summary, null, 2));
  for (const error of result.errors) console.log(`  ${keyOf(error)}`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2));
  process.exit(summary.same ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(2);
});
