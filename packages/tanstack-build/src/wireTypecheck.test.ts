import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { wiredValServer, type WireOptions } from "./wire";

/**
 * Does the `val.server.ts` this package GENERATES compile against the
 * `initValServer` it is written for?
 *
 * This is the whole argument for the wiring living in this repository, and
 * until this test existed it was an argument rather than a fact. The generated
 * file is a template string, so the compiler never sees it; it reaches a
 * project as bytes in a published build, where a mistake in it is a runtime
 * error in somebody else's isolate.
 *
 * The platform repository does have a check, and it deliberately cannot catch
 * this: it runs `tsc --noResolve`, so the imports do not resolve and only free
 * identifiers are reported. That is the right check for the bug it was written
 * for — a rename that left one branch referring to a name that no longer
 * existed — and it is blind to the signature on the other side of the import.
 *
 * So: with resolution, against the real package.
 *
 * One thing it deliberately does NOT settle, and the test at the bottom of this
 * file says why: this compiles the template against the `@valbuild/tanstack` in
 * THIS repository, and the template is compiled and run against the one the
 * PROJECT installed. Where the two disagree about a name, the compiler here is
 * the wrong witness — it says so with authority and is talking about a version
 * the app does not have.
 */

/**
 * Both shapes, because they are different programs.
 *
 * `BUILT_FROM` is emitted as a literal — an object for a build made from a
 * commit, `null` for one that was not — so each variant type-checks its own
 * branches. The bug above lived in the half that HAS a commit, which is the
 * half a CI publish produces and the half no fixture in either repository
 * compiled.
 */
const VARIANTS: Record<string, WireOptions> = {
  "no commit (a seeded build)": {
    project: "p",
    loader: "https://loader.example",
  },
  "a commit (a build from a repository)": {
    project: "p",
    loader: "https://loader.example",
    git: { commit: "0123456789abcdef0123456789abcdef01234567", branch: "main" },
  },
};

/**
 * Dead branches in the commitless build, which are pre-existing and not this
 * package's to fix here.
 *
 * `BUILT_FROM` is emitted as a bare literal — it has to be, because `bakedGit`
 * reads the commit back out of the generated source with
 * `/^const BUILT_FROM = (.+);$/`, which is how a project adopted from its live
 * build learns what it was built at. A `const` initialised to `null` is
 * narrowed to `null` by control flow, so every `BUILT_FROM !== null` branch is
 * `never` and each `.commit` inside one is an error — in code that provably
 * cannot run. An annotation does not help (the initialiser still narrows it)
 * and a cast or a specialised template would both be larger changes than the
 * bug they fix.
 *
 * Filtered rather than waved through wholesale: any OTHER error in this variant
 * still fails, and the variant that carries a commit is checked with nothing
 * filtered at all — which is where the regression this file exists for lived.
 */
const DEAD_BRANCH =
  /error TS2339: Property '(commit|branch)' does not exist on type 'never'\./;

/**
 * Ambient names the isolate really does provide.
 *
 * Declared rather than waved through, so a typo in one of them is still an
 * error. `__PLATFORM_SECRETS` and `__PLATFORM_PROJECT_ID` are the platform's
 * own, injected into the isolate at startup.
 */
const AMBIENT = `
export {};
declare global {
  var __PLATFORM_SECRETS: Record<string, string> | undefined;
  var __PLATFORM_PROJECT_ID: string | undefined;
}
`;

/**
 * Stand-ins for the two modules every Val project has.
 *
 * Real ones, not `any`: the point is to resolve `@valbuild/tanstack/server`
 * for real, and handing it a `config` of `any` would make `initValServer`'s
 * first two parameters unchecked and quietly give up half the coverage.
 */
const VAL_CONFIG = `
import { initVal } from "@valbuild/tanstack";
const { config } = initVal({ project: "org/project" });
export { config };
`;

const VAL_MODULES = `
import { modules } from "@valbuild/tanstack";
import { config } from "./val.config";
export default modules(config, []);
`;

/**
 * Inside the package, not in os.tmpdir(), and that is load bearing: the
 * generated file imports `@valbuild/tanstack/server` by name, so it has to sit
 * somewhere Node's resolution walks up from into this workspace's
 * node_modules. A temp directory elsewhere resolves nothing and the test
 * passes by checking an empty program.
 */
const ROOT = path.join(__dirname, "..", ".tmp");

function typecheck(name: string, options: WireOptions): string {
  const dir = path.join(ROOT, name.replace(/[^a-z0-9]+/gi, "-"));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "src", "val"), { recursive: true });

  fs.writeFileSync(path.join(dir, "ambient.d.ts"), AMBIENT);
  fs.writeFileSync(path.join(dir, "val.config.ts"), VAL_CONFIG);
  fs.writeFileSync(path.join(dir, "val.modules.ts"), VAL_MODULES);
  fs.writeFileSync(
    path.join(dir, "src", "val", "val.server.ts"),
    wiredValServer(options),
  );
  /*
   * `paths` rather than a devDependency on `@valbuild/tanstack`.
   *
   * A real dependency would resolve through the package's own `exports` map,
   * which is better fidelity — but `@valbuild/ui` is about to depend on THIS
   * package (that is what the /node split is for), and `@valbuild/tanstack`
   * depends on `@valbuild/ui`, so declaring it here would close a cycle
   * through the build graph. A test-only mapping costs nothing and closes
   * nothing.
   */
  // Relative to the tsconfig, because `baseUrl` is deprecated in TypeScript 6
  // and an error in this repository's own compiler.
  const tanstack = path.relative(
    dir,
    path.join(__dirname, "..", "..", "tanstack", "src"),
  );
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        lib: ["ES2022", "DOM"],
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        esModuleInterop: true,
        skipLibCheck: true,
        // `node`, because the generated file reads `process.env` — as it may,
        // since a Val project has @types/node.
        types: ["node"],
        paths: {
          "@valbuild/tanstack": [`${tanstack}/index.ts`],
          "@valbuild/tanstack/server": [`${tanstack}/server/index.ts`],
        },
      },
      include: ["**/*.ts"],
    }),
  );

  try {
    execFileSync(
      path.join(__dirname, "..", "..", "..", "node_modules", ".bin", "tsc"),
      ["-p", dir],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return "";
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string };
    return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  }
}

describe("the generated val.server.ts", () => {
  // tsc on a program that pulls in @valbuild/tanstack's type graph.
  jest.setTimeout(180_000);

  afterAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
  });

  test("compiles against @valbuild/tanstack/server — a commit (a build from a repository)", () => {
    const label = "a commit (a build from a repository)";
    expect(typecheck(label, VARIANTS[label]!)).toBe("");
  });

  test("compiles against @valbuild/tanstack/server — no commit (a seeded build)", () => {
    const label = "no commit (a seeded build)";
    const errors = typecheck(label, VARIANTS[label]!)
      .split("\n")
      .filter((line) => line.trim() !== "" && !DEAD_BRANCH.test(line));
    expect(errors).toEqual([]);
  });

  test("the commit is sent under every name ValHttpMode has had", () => {
    /*
     * The compile above cannot decide this one, and that is why both exist.
     *
     * It compiles against THIS repository's `@valbuild/tanstack`. The file it
     * compiles is written into somebody else's project and compiled — and run —
     * against the one that project installed, and `ValHttpMode` has been
     * renamed in both directions: `gitCommit`/`gitBranch` up to 0.132, a nested
     * `git` in 0.133.0, flat again in the version this package ships beside.
     * The starter pins 0.133.0. So the compiler here is a witness to one
     * version and the template has to satisfy several.
     *
     * All three keys, therefore. An unknown one is ignored, so the cost is a
     * dead key and the alternative is silence: the commit is dropped, the
     * publish produces no mirrored `.val.ts`, and a save commits and hands over
     * nothing. valbuild/home's loop is the only check anywhere that sees it —
     * 25/25 with the key the installed version reads, 21/23 without, failing at
     * "the save left the file it rewrote pending". This test is the cheap one
     * that stands in front of that.
     */
    const wired = wiredValServer(
      VARIANTS["a commit (a build from a repository)"]!,
    );
    // Comments stripped: the note explaining this quotes the shapes it is
    // about, and a canary its own explanation satisfies is worthless.
    const code = wired.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).toMatch(/\bgit:\s*BUILT_FROM\b/);
    expect(code).toContain("gitCommit: BUILT_FROM.commit");
    expect(code).toContain("gitBranch: BUILT_FROM.branch");
  });
});
