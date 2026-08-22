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
