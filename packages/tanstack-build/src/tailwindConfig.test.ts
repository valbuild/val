import { execFileSync } from "child_process";
import path from "path";

/**
 * `@config` / `@plugin` with a path relative to the stylesheet resolve the way
 * they do under Vite, and when they cannot, the build says which of the two
 * things is wrong.
 *
 * blankno-v4's first publish stopped on
 *
 *     Tailwind's '@config "../tailwind.config.js"' could not be resolved from
 *     the project. Add it to package.json and install, or remove the directive.
 *
 * for a file that was there: Tailwind was compiled with `base: "/"`, so the
 * loader resolved the path from the root of the disk -- and the advice was for
 * a package, which a relative path is not. See the probe beside this file.
 */
type Outcome = { css: string } | { error: string };
let probe: Record<
  | "relative"
  | "fromAnImportedSheet"
  | "missingFile"
  | "missingPackage"
  | "noLoader",
  Outcome
>;

beforeAll(() => {
  const out = execFileSync(
    path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, "__fixtures__", "tailwindConfigProbe.ts")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  probe = JSON.parse(line!) as typeof probe;
}, 300_000);

const cssOf = (outcome: Outcome) => {
  if ("error" in outcome) throw new Error(outcome.error);
  return outcome.css;
};
const errorOf = (outcome: Outcome) =>
  "error" in outcome ? outcome.error : `built: ${outcome.css.slice(0, 80)}`;

test("a path relative to the stylesheet finds the config beside the project", () => {
  expect(cssOf(probe.relative)).toMatch(
    /\.bg-brand\s*\{\s*background-color: #abcdef/,
  );
});

test("relative to the sheet that wrote it, when that sheet was imported by another", () => {
  // The sheets are concatenated before Tailwind runs, so this is the case
  // where the directory has to have been applied before then.
  expect(cssOf(probe.fromAnImportedSheet)).toMatch(
    /\.bg-brand\s*\{\s*background-color: #abcdef/,
  );
});

test("a relative path to nothing says the file does not exist, not to install it", () => {
  const error = errorOf(probe.missingFile);
  expect(error).toContain("does not exist");
  expect(error).toContain("'tailwind.config.ts'");
  expect(error).not.toContain("package.json");
});

test("a package that is not installed says to add it, by its package name", () => {
  const error = errorOf(probe.missingPackage);
  expect(error).toContain("not installed");
  expect(error).toContain("Add '@acme/tailwind-plugin' to package.json");
});

test("a build that cannot load modules points at what the stylesheet can say instead", () => {
  const error = errorOf(probe.noLoader);
  expect(error).toContain("@theme");
  expect(error).toContain("@utility");
  expect(error).toContain("@custom-variant");
});
