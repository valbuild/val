// The four environment-splitting passes, other than createServerFn.
//
// TanStack Start implements these as Babel passes over user code:
// `handleCreateIsomorphicFn`, `handleEnvOnly`, `handleCreateMiddleware` and
// `handleClientOnlyJSX`. They are markers, not runtime helpers -- the shipped
// implementations are only the fallback for when nobody rewrites them, and
// that fallback is wrong in a browser. `createIsomorphicFn().client(a).server(b)`
// resolves to `b` in *either* chain order, which is how `getStartOptions` ended
// up calling `getStartContext()` in a tab.
//
// The vendor build already shims two of these for Start's *own* runtime
// (packages/vendor/src/build.ts). That does nothing for user code, which is
// what this file is for: a user writing `createIsomorphicFn()` in their own
// project hits exactly the bug the vendor shim exists to paper over.
//
// Each transform below is a direct port; the comments name the upstream pass so
// the correspondence stays checkable.
import {
  applyEdits,
  parse,
  tanstackImports,
  walk,
  type Edit,
  type Node,
} from "./ast";

/** Cheap pre-filter: skip the parse unless one of these appears in the source. */
const MARKERS = [
  "createIsomorphicFn",
  "createServerOnlyFn",
  "createClientOnlyFn",
  "createMiddleware",
  "ClientOnly",
];

/** Walks a `foo().bar().baz()` chain down to its root callee identifier. */
function chainRoot(node: Node | null | undefined): string | null {
  let current = node;
  while (current) {
    if (current.type === "CallExpression") {
      const callee = current.callee as Node;
      if (callee?.type === "Identifier") return String(callee.name);
      if (callee?.type === "MemberExpression") {
        current = callee.object as Node;
        continue;
      }
      return null;
    }
    return null;
  }
  return null;
}

/**
 * True when this call is the whole chain rather than a link in a longer one.
 *
 * Without this, `createIsomorphicFn().client(a).server(b)` matches three times
 * and the inner replacements land inside text the outer one is about to
 * replace.
 */
function isOutermost(node: Node, stack: Array<Node>) {
  const parent = stack[stack.length - 1];
  const grandparent = stack[stack.length - 2];
  return !(
    parent?.type === "MemberExpression" &&
    parent.object === node &&
    grandparent?.type === "CallExpression"
  );
}

/** Collects `.method(arg)` calls along a chain, nearest-root first. */
function methodsOf(node: Node) {
  const found = new Map<
    string,
    { call: Node; arg: Node | undefined; objectEnd: number }
  >();
  let current: Node | undefined = node;
  while (current?.type === "CallExpression") {
    const callee = current.callee as Node;
    if (callee?.type !== "MemberExpression") break;
    const name = String((callee.property as Node)?.name ?? "");
    // Nearest-to-root wins, so a later duplicate does not shadow the first.
    found.set(name, {
      call: current,
      arg: (current.arguments as Array<Node>)?.[0],
      objectEnd: (callee.object as Node).end,
    });
    current = callee.object as Node;
  }
  return found;
}

export interface EnvTransformResult {
  code: string;
  applied: Array<string>;
}

/**
 * Rewrites the environment markers in one module for one target.
 *
 * Returns `null` when the module contains none, so the caller leaves it alone
 * and pays no parse.
 */
export async function transformEnvMarkers(
  moduleId: string,
  code: string,
  target: "server" | "client",
): Promise<EnvTransformResult | null> {
  if (!MARKERS.some((marker) => code.includes(marker))) return null;

  const ast = await parse(moduleId, code);
  const imported = tanstackImports(ast);
  if (imported.size === 0) return null;

  const edits: Array<Edit> = [];
  const applied: Array<string> = [];
  const text = (node: Node) => code.slice(node.start, node.end);

  walk(ast, (node, stack) => {
    // --- handleClientOnlyJSX ---------------------------------------------
    // On the server the children of <ClientOnly> are dropped and the element
    // becomes self-closing, so only the fallback renders.
    if (node.type === "JSXElement" && target === "server") {
      const opening = node.openingElement as Node;
      const name = (opening?.name as Node)?.name;
      if (
        name === "ClientOnly" &&
        imported.has("ClientOnly") &&
        !opening.selfClosing
      ) {
        // From the `>` of the opening tag through the closing tag becomes `/>`.
        edits.push({ start: opening.end - 1, end: node.end, text: " />" });
        applied.push("ClientOnly");
      }
      return;
    }

    if (node.type !== "CallExpression") return;

    // --- handleEnvOnly ----------------------------------------------------
    // createServerOnlyFn(fn) is `fn` on the server and a throwing stub on the
    // client; createClientOnlyFn the mirror image. A stub rather than a no-op,
    // because silently doing nothing is how a server-only call in a tab turns
    // into a confusing downstream failure instead of a clear one.
    const callee = node.callee as Node;
    if (callee?.type === "Identifier") {
      const name = String(callee.name);
      const envOnly =
        name === "createServerOnlyFn"
          ? "server"
          : name === "createClientOnlyFn"
            ? "client"
            : null;
      if (envOnly && imported.has(name)) {
        const inner = (node.arguments as Array<Node>)?.[0];
        if (!inner) {
          throw new Error(
            `${moduleId}: ${name}() must be called with a function.`,
          );
        }
        edits.push({
          start: node.start,
          end: node.end,
          text:
            target === envOnly
              ? text(inner)
              : `(() => { throw new Error(${JSON.stringify(
                  `${name}() functions can only be called on the ${envOnly}!`,
                )}) })`,
        });
        applied.push(name);
      }
      return;
    }

    if (callee?.type !== "MemberExpression" || !isOutermost(node, stack))
      return;

    const root = chainRoot(node);
    if (!root || !imported.has(root)) return;

    // --- handleCreateIsomorphicFn ----------------------------------------
    // The whole chain collapses to this environment's implementation. With no
    // implementation for this environment, a no-op -- which is what Start does,
    // and what makes a `.server()`-only isomorphic fn safe to reference in a
    // browser.
    if (root === "createIsomorphicFn") {
      const methods = methodsOf(node);
      const chosen = methods.get(target);
      if (chosen && !chosen.arg) {
        throw new Error(
          `${moduleId}: createIsomorphicFn().${target}() must be called with a function.`,
        );
      }
      edits.push({
        start: node.start,
        end: node.end,
        text: chosen?.arg ? text(chosen.arg) : "(() => {})",
      });
      applied.push("createIsomorphicFn");
      return;
    }

    // --- handleCreateMiddleware -------------------------------------------
    // Client only, and it strips rather than replaces: the middleware object
    // survives, but its `.server()` body and validators do not reach the
    // browser. Upstream this pass throws if run on the server, which is the
    // clearest statement that the server keeps everything.
    if (root === "createMiddleware" && target === "client") {
      for (const name of ["server", "validator", "inputValidator"]) {
        const method = methodsOf(node).get(name);
        if (!method) continue;
        if (name !== "server" && !method.arg) {
          throw new Error(
            `${moduleId}: createMiddleware().${name}() must be called with a validator.`,
          );
        }
        // Drop `.name(...)`, leaving the object it was called on.
        edits.push({ start: method.objectEnd, end: method.call.end, text: "" });
        applied.push(`createMiddleware.${name}`);
      }
    }
  });

  if (edits.length === 0) return null;
  return { code: applyEdits(code, edits), applied };
}
