// Shared AST plumbing for the per-call-site transforms.
//
// Every transform here has the same shape: find a call site, decide what it
// should become in *this* target, and splice the source. They are separate from
// each other because TanStack Start implements them as separate Babel passes,
// and keeping the correspondence makes them checkable against the originals.
import { parseAstAsync } from "@rolldown/browser/parseAst";

export interface Node {
  type: string;
  start: number;
  end: number;
  // oxc's AST is not typed here, and every walk below reaches through several
  // levels of it (`declaration.id.name`, `specifier.exported`). `unknown` would
  // need a cast at each of those, which moves the same claim somewhere it is
  // harder to see.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface Edit {
  start: number;
  end: number;
  text: string;
}

export const langOf = (path: string) =>
  path.endsWith(".tsx") || path.endsWith(".jsx")
    ? ("tsx" as const)
    : ("ts" as const);

export async function parse(path: string, code: string) {
  return (await parseAstAsync(
    code,
    { lang: langOf(path) },
    path,
  )) as unknown as Node;
}

/** Depth-first walk carrying a parent stack, nearest parent last. */
export function walk(
  node: Node,
  visit: (node: Node, stack: Array<Node>) => void,
  stack: Array<Node> = [],
) {
  if (!node || typeof node.type !== "string") return;
  visit(node, stack);
  stack.push(node);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value)
        if (item && typeof item.type === "string") walk(item, visit, stack);
    } else if (value && typeof value.type === "string") {
      walk(value, visit, stack);
    }
  }
  stack.pop();
}

/** Applies edits end-first, so earlier offsets stay valid. */
export function applyEdits(code: string, edits: Array<Edit>) {
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = code;
  for (const edit of ordered)
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

/**
 * Local names imported from a TanStack package.
 *
 * The transforms key on names like `createIsomorphicFn`, and keying on the name
 * alone would rewrite an unrelated local function that happens to share it.
 * Start's compiler tracks imports for the same reason.
 */
export function tanstackImports(ast: Node) {
  const names = new Set<string>();
  for (const statement of ast.body as Array<Node>) {
    if (statement.type !== "ImportDeclaration") continue;
    const source = String((statement.source as Node)?.value ?? "");
    if (!source.startsWith("@tanstack/")) continue;
    for (const specifier of (statement.specifiers ?? []) as Array<Node>) {
      const local = (specifier.local as Node)?.name;
      if (local) names.add(String(local));
    }
  }
  return names;
}
