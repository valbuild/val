import path from "path";
import ts from "typescript";
import type { ModuleFilePath } from "@valbuild/core";

/**
 * Works out which Val modules a `val.modules.{ts,js}` file registers.
 *
 * Val only serves modules listed there, so an unregistered `.val.ts` file
 * silently does nothing.
 *
 * Rather than pattern-matching the accepted authoring shapes — `config.modules([…])`
 * vs `modules(config, […])`, bare `import("./x.val")` vs
 * `{ def: () => import("./x.val") }` — this collects *every* dynamic import
 * specifier in the file. That is deliberate:
 *
 *  - it covers all current shapes with one rule, and any shape added later;
 *  - when in doubt it over-reports registration, so a new authoring form makes
 *    the diagnostic go quiet rather than firing a false "missing module" on
 *    every file, which is the failure mode that actually hurts.
 */
export function findRegisteredModuleSpecifiers(
  sourceFile: ts.SourceFile,
): string[] {
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteralLike(arg)) {
        specifiers.push(arg.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return specifiers;
}

/**
 * Whether `moduleFilePath` is registered by the given `val.modules` file.
 *
 * @param valModulesDir directory containing the val.modules file, relative to
 *   the Val root (`""` when it sits at the root).
 * @param moduleFilePath the module's path, Val-style: root-relative, leading
 *   slash, with extension (for example `/content/page.val.ts`).
 */
export function isModuleRegistered({
  sourceFile,
  valModulesDir,
  moduleFilePath,
}: {
  sourceFile: ts.SourceFile;
  valModulesDir: string;
  moduleFilePath: ModuleFilePath;
}): boolean {
  const target = stripValModuleExtension(moduleFilePath);
  return findRegisteredModuleSpecifiers(sourceFile).some((specifier) => {
    // Specifiers are written relative to the val.modules file and normally omit
    // the extension ("./content/page.val").
    const resolved = specifier.startsWith(".")
      ? path.posix.normalize(
          path.posix.join(
            "/",
            valModulesDir,
            stripValModuleExtension(specifier),
          ),
        )
      : stripValModuleExtension(specifier);
    return resolved === target;
  });
}

/** `/content/page.val.ts` -> `/content/page.val` (also handles `.val` already). */
function stripValModuleExtension(specifier: string): string {
  return specifier.replace(/\.val\.(ts|js|tsx|jsx)$/, ".val");
}

/**
 * Where to insert a new entry in a `val.modules` file, and how to indent it.
 *
 * Only `modules(config, [ … ])` is matched, because that is the shape Val
 * actually accepts and the shape `examples/next/val.modules.ts` uses. The
 * over-reporting rule in {@link findRegisteredModuleSpecifiers} is right for
 * *reading* a file someone else wrote; writing into one has to commit to a
 * shape, and guessing wrong produces a file that no longer compiles.
 *
 * Returns `null` when the array cannot be found — the caller then offers no fix
 * rather than inserting somewhere arbitrary.
 */
export function findValModulesInsertion(
  sourceFile: ts.SourceFile,
): { insertOffset: number; indentation: string; hasElements: boolean } | null {
  let found: {
    insertOffset: number;
    indentation: string;
    hasElements: boolean;
  } | null = null;

  function visit(node: ts.Node): void {
    if (
      found === null &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "modules" &&
      node.arguments.length >= 2
    ) {
      const array = node.arguments[1];
      if (ts.isArrayLiteralExpression(array)) {
        if (array.elements.length > 0) {
          const last = array.elements[array.elements.length - 1];
          const first = array.elements[0];
          const { character } = sourceFile.getLineAndCharacterOfPosition(
            first.getStart(sourceFile),
          );
          found = {
            insertOffset: last.end,
            indentation: " ".repeat(character),
            hasElements: true,
          };
        } else {
          found = {
            // Just after the `[`.
            insertOffset: array.getStart(sourceFile) + 1,
            indentation: "  ",
            hasElements: false,
          };
        }
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return found;
}

/**
 * The specifier to write for `moduleFilePath`, relative to the `val.modules`
 * file that will hold it.
 *
 * Both paths are Val-style (root-relative, leading slash). POSIX separators
 * always: the string ends up in an `import()` in source, where a backslash is an
 * escape rather than a separator.
 */
export function valModuleSpecifier({
  valModulesFilePath,
  moduleFilePath,
}: {
  valModulesFilePath: string;
  moduleFilePath: ModuleFilePath;
}): string {
  const relative = path.posix.relative(
    path.posix.dirname(valModulesFilePath),
    stripValModuleExtension(moduleFilePath),
  );
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/** The text to insert for one new entry, including its separator. */
export function valModulesEntryText({
  specifier,
  indentation,
  hasElements,
}: {
  specifier: string;
  indentation: string;
  hasElements: boolean;
}): string {
  const entry = `{ def: () => import("${specifier}") }`;
  return hasElements
    ? `,\n${indentation}${entry}`
    : `\n${indentation}${entry}\n${indentation.slice(2)}`;
}
