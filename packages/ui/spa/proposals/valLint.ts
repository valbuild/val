import { Linter } from "eslint/universal";
import type { AST } from "eslint";
import { parse } from "@babel/parser";
import {
  createRules,
  registeredSpecifiers,
} from "@valbuild/eslint-plugin/rules";
import type { LintMessage } from "./lintCode";

/**
 * Val's eslint rules (`@valbuild/eslint-plugin`) over a proposal's files, in
 * the tab: the half of `lintCode.ts` that is megabytes, imported only when
 * something is linted.
 *
 * The project is the files in memory, by path from its root, so a file is
 * linted as `/<path>` with the root as the working directory -- which is also
 * the module path `c.define` must name, as on a checkout whose package.json
 * is at the root.
 *
 * Parsed by Babel, not typescript-eslint: the rules read only the module's
 * shape (imports, the default export, its call), Babel's `estree` output is
 * that shape, and typescript-eslint would bring a TypeScript of its own into a
 * page that loads the project's own for the typecheck.
 */

const ROOT = "/";
const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** Babel's parse, as ESLint asks a parser for one. */
const parser: Linter.Parser = {
  meta: { name: "val-babel-estree" },
  parseForESLint(code: string) {
    const file = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx", "estree"],
      ranges: true,
      errorRecovery: false,
    });
    const program: unknown = {
      ...file.program,
      range: [0, code.length],
      // The rules read none: what ESLint needs of tokens here is an array.
      tokens: [],
      comments: (file.comments ?? []).map((comment) => ({
        type: comment.type === "CommentBlock" ? "Block" : "Line",
        value: comment.value,
        range: [comment.start, comment.end],
        loc: comment.loc,
      })),
    };
    if (!isProgram(program)) {
      throw new Error("Babel did not parse this as a program.");
    }
    return { ast: program };
  },
};

function isProgram(value: unknown): value is AST.Program {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "Program" &&
    "body" in value &&
    Array.isArray(value.body)
  );
}

/**
 * The files `val.modules.ts` registers, as linted filenames, or `null` when
 * there is none -- or when one of them cannot be found, because a module
 * reported as unregistered when it is registered under a path this cannot
 * resolve (a `paths` alias) is worse than not checking.
 */
function registeredModulesOf(project: Record<string, string>): string[] | null {
  const text = project["val.modules.ts"] ?? project["val.modules.js"];
  if (text === undefined) return null;
  const found: string[] = [];
  for (const specifier of registeredSpecifiers(text)) {
    if (!specifier.startsWith("./")) return null;
    const base = specifier.slice(2);
    const path = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find(
      (candidate) => project[candidate] !== undefined,
    );
    if (path === undefined) return null;
    found.push(ROOT + path);
  }
  return found;
}

/**
 * Lint `paths` of `project` with every rule of Val's plugin. `fix`: answer
 * the fixed text of the files the rules can fix.
 */
export function lintProject(
  project: Record<string, string>,
  paths: string[],
  options: { fix?: boolean } = {},
): { messages: LintMessage[]; fixed: Record<string, string> } {
  const registered = registeredModulesOf(project);
  const rules = createRules({
    modulePathOf: (filename) => filename,
    registeredModules: () => registered,
    displayPath: (filename) => filename,
  });
  const config: Linter.Config[] = [
    {
      // Extensions, not "**/*": ESLint applies a config matching only that
      // to files some other config matches, and there is no other.
      files: ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"],
      languageOptions: { parser },
      plugins: { "@valbuild": { rules } },
      rules: Object.fromEntries(
        Object.keys(rules).map((rule) => [`@valbuild/${rule}`, "error"]),
      ),
    },
  ];
  const linter = new Linter({ configType: "flat", cwd: ROOT });
  const messages: LintMessage[] = [];
  const fixed: Record<string, string> = {};
  for (const path of paths) {
    const text = project[path];
    if (text === undefined || !CODE.test(path) || path.endsWith(".d.ts")) {
      continue;
    }
    const filename = ROOT + path;
    let found: Linter.LintMessage[];
    if (options.fix) {
      const report = linter.verifyAndFix(text, config, { filename });
      found = report.messages;
      if (report.fixed) fixed[path] = report.output;
    } else {
      found = linter.verify(text, config, { filename });
    }
    for (const message of found) {
      messages.push({
        path,
        line: message.line,
        column: message.column,
        rule: message.ruleId?.replace(/^@valbuild\//, "") ?? null,
        message: message.message,
        fixable: message.fix !== undefined,
      });
    }
  }
  return { messages, fixed };
}
