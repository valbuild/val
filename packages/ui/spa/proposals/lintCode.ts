/**
 * The assistant's `lint`: Val's eslint rules (`@valbuild/eslint-plugin`) over
 * the proposal's files.
 *
 * The rules catch what a `.val.ts` file can get wrong that TypeScript does
 * not: a module path that is not the file's, a module missing from
 * `val.modules.ts`, a `c.define` whose content is a variable (which validates
 * and then fails at publish), an import a module may not make. When one of
 * them fires, something is wrong -- which is what makes them worth running on
 * every change an agent makes, not only in a developer's editor.
 *
 * The rules themselves are in `valLint.ts`, which is loaded the first time
 * anything is linted: ESLint and a parser are megabytes the Studio has no use
 * for until then.
 */

/** One problem the rules found. */
export type LintMessage = {
  path: string;
  line: number;
  column: number;
  /** The rule, without its `@valbuild/` prefix; `null` for a file that does not parse. */
  rule: string | null;
  message: string;
  /** Whether `lint` with `fix` can fix it. */
  fixable: boolean;
};

const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const VAL_FILE = /\.val\.(?:[jt]sx?)$/;
const VAL_MODULES = /^val\.modules\.[jt]s$/;

/**
 * What a lint of these staged files has to read: the staged code files, and
 * -- when `val.modules.ts` is one of them -- every `.val` file, because a
 * module it no longer registers is a problem in a file that did not change.
 */
export function pathsToLint(
  project: Record<string, string>,
  staged: string[],
): string[] {
  const paths = new Set(staged.filter((path) => CODE.test(path)));
  if (staged.some((path) => VAL_MODULES.test(path))) {
    for (const path of Object.keys(project)) {
      if (VAL_FILE.test(path)) paths.add(path);
    }
  }
  return [...paths].filter((path) => project[path] !== undefined).sort();
}

/** Lint `paths` of `project` with Val's rules: see `valLint.ts`. */
export async function lintWithValRules(
  project: Record<string, string>,
  paths: string[],
  options: { fix?: boolean } = {},
): Promise<{ messages: LintMessage[]; fixed: Record<string, string> }> {
  const { lintProject } = await import("./valLint");
  return lintProject(project, paths, options);
}
