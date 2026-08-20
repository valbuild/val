import path from "path";
import ts from "typescript";

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs"];

export type ImportGraphResult = {
  /** Project-relative path (leading "/") -> file contents. */
  files: Record<string, string>;
  /**
   * Specifiers we could not resolve to a project file: bare packages (fine,
   * they come from node_modules) and tsconfig path aliases (NOT fine - the
   * snapshot will not evaluate). Recorded so the manifest can say so out loud
   * rather than shipping a bundle that mysteriously fails to load.
   */
  unresolved: { from: string; specifier: string }[];
};

/**
 * Walks the relative-import graph of `entryFiles` and reads every project file
 * it reaches, using `readFile` so the contents come from the same revision as
 * the modules themselves (the deployed commit in http mode).
 *
 * `loadValModules` evaluates val.modules.ts and everything it imports in a vm,
 * so a snapshot that is missing an imported file (a shared schema fragment, or
 * val.config itself) cannot be replayed at all.
 */
export async function collectImportedProjectFiles(
  entryFiles: { path: string; contents: string }[],
  readFile: (projectRelativePath: string) => Promise<string | null>,
): Promise<ImportGraphResult> {
  const files: Record<string, string> = {};
  const unresolved: { from: string; specifier: string }[] = [];
  const seen = new Set<string>();
  const queue: { path: string; contents: string }[] = [];

  for (const entry of entryFiles) {
    seen.add(entry.path);
    queue.push(entry);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }
    const dir = path.posix.dirname(current.path);
    for (const specifier of readImportSpecifiers(
      current.path,
      current.contents,
    )) {
      if (!specifier.startsWith(".")) {
        unresolved.push({ from: current.path, specifier });
        continue;
      }
      const base = path.posix.resolve(dir, specifier);
      const resolved = await resolveProjectFile(base, readFile);
      if (!resolved) {
        unresolved.push({ from: current.path, specifier });
        continue;
      }
      if (seen.has(resolved.path)) {
        continue;
      }
      seen.add(resolved.path);
      files[resolved.path] = resolved.contents;
      queue.push(resolved);
    }
  }

  return { files, unresolved };
}

async function resolveProjectFile(
  base: string,
  readFile: (projectRelativePath: string) => Promise<string | null>,
): Promise<{ path: string; contents: string } | null> {
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((ext) => base + ext),
    ...RESOLVE_EXTENSIONS.map((ext) => path.posix.join(base, "index" + ext)),
  ];
  for (const candidate of candidates) {
    const contents = await readFile(candidate);
    if (contents !== null) {
      return { path: candidate, contents };
    }
  }
  return null;
}

/**
 * Every module specifier in the file: static imports/exports and the dynamic
 * `import()` calls val.modules.ts is built out of.
 */
function readImportSpecifiers(filePath: string, contents: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    contents,
    ts.ScriptTarget.ES2020,
    true,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg)) {
        specifiers.push(arg.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}
