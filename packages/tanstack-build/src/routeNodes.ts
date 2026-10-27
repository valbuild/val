// Server-only route options, removed from the client build.
//
// A file route can carry options that only ever run on the server:
//
//   createFileRoute('/api/echo')({
//     server: { handlers: { POST: async ({ request }) => { ...db query... } } },
//     ssr: false,
//     headers: () => ({ 'set-cookie': ... }),
//   })
//
// Nothing on the client reads those, but the route file is one module and the
// client build imports it for the component next to them. Without this pass the
// handler *bodies* are published as part of `/_app/app.js` -- readable by any
// visitor, along with whatever they close over.
//
// TanStack Start does this in its router plugin, as the `deleteNodes` option of
// the code splitter, applied to the client environment only
// (`@tanstack/start-plugin-core`, start-router-plugin). We are outside that
// plugin, so this is a direct port of the same three names.
//
// It is a deliberately narrow pass: it removes properties, and does not try to
// remove imports that only those properties used. Those are left for the
// bundler to tree-shake, which it can do because the property is gone.
import {
  applyEdits,
  parse,
  tanstackImports,
  walk,
  type Edit,
  type Node,
} from "./ast";

/**
 * The names Start deletes from the client build.
 *
 * `ssr` and `headers` are server-rendering decisions with no client meaning;
 * `server` is the route's HTTP handlers. Kept as a literal set rather than
 * derived, so it can be diffed against Start's when versions move.
 */
const SERVER_ONLY_OPTIONS = new Set(["ssr", "server", "headers"]);

/**
 * The route constructors whose options object this applies to.
 *
 * Matches Start's `allCreateRouteFns`. `createLazyFileRoute` is deliberately
 * absent: a lazy route file carries only the client half, so there is nothing
 * server-only in it to delete.
 */
const ROUTE_FNS = new Set([
  "createFileRoute",
  "createRootRoute",
  "createRootRouteWithContext",
]);

/** Cheap pre-filter, so a module with no route call is never parsed. */
const shouldRun = (code: string) =>
  [...ROUTE_FNS].some((name) => code.includes(name)) &&
  [...SERVER_ONLY_OPTIONS].some((name) => code.includes(name));

export interface RouteNodeResult {
  code: string;
  /** Which options were removed, for reporting. */
  removed: Array<string>;
}

/**
 * The options object of a route call, in either of its two shapes.
 *
 *   createRootRoute({ ... })            the argument
 *   createFileRoute('/x')({ ... })      the argument of the *returned* call
 */
function routeOptionsOf(node: Node, stack: Array<Node>): Node | null {
  const parent = stack[stack.length - 1];
  const direct = (node.arguments as Array<Node>)?.[0];

  if (parent?.type === "CallExpression" && parent.callee === node) {
    const curried = (parent.arguments as Array<Node>)?.[0];
    return curried?.type === "ObjectExpression" ? curried : null;
  }
  return direct?.type === "ObjectExpression" ? direct : null;
}

/** A property's own name, for the plain `key: value` form only. */
function propertyName(property: Node): string | null {
  // Matching Start, which filters on `isObjectProperty`: a shorthand method
  // (`server() {}`) and a spread are both left alone. A method would be a
  // strange way to write these options, and a spread cannot be read statically.
  if (property.type !== "Property" || property.method) return null;
  const key = property.key as Node;
  if (!key) return null;
  if (property.computed) return null;
  if (key.type === "Identifier") return String(key.name);
  if (key.type === "Literal") return String(key.value);
  return null;
}

/**
 * Edits that delete the flagged properties of one object literal.
 *
 * Deleting each property on its own does not work. A property's own range
 * leaves the comma behind (`{ a: 1, , c: 3 }`, which does not parse), and
 * extending each one over its neighbouring comma makes *adjacent* deletions
 * overlap -- two edits claiming the same comma, which corrupts the source
 * rather than failing.
 *
 * So deletions are grouped into runs of consecutive properties, and each run
 * takes exactly one comma: the one before it when it has a surviving property
 * to its left, the one after it otherwise.
 */
function deleteProperties(
  code: string,
  properties: Array<Node>,
  doomed: Set<Node>,
): Array<Edit> {
  const edits: Array<Edit> = [];

  for (let i = 0; i < properties.length; i++) {
    if (!doomed.has(properties[i]!)) continue;
    let j = i;
    while (j + 1 < properties.length && doomed.has(properties[j + 1]!)) j++;

    if (i > 0) {
      // From the end of the property before the run, which takes the comma
      // separating them.
      edits.push({
        start: properties[i - 1]!.end,
        end: properties[j]!.end,
        text: "",
      });
    } else if (j + 1 < properties.length) {
      // Run starts the object: take the comma that follows it instead.
      edits.push({
        start: properties[0]!.start,
        end: properties[j + 1]!.start,
        text: "",
      });
    } else {
      // The whole object goes. There is no separating comma, but there may be
      // a trailing one, and `{ , }` does not parse any better than `{ ,`.
      let end = properties[j]!.end;
      let cursor = end;
      while (cursor < code.length && /\s/.test(code[cursor]!)) cursor++;
      if (code[cursor] === ",") end = cursor + 1;
      edits.push({ start: properties[0]!.start, end, text: "" });
    }

    i = j;
  }

  return edits;
}

/**
 * Removes server-only route options from one module.
 *
 * Returns `null` when there is nothing to do, so the caller pays no parse.
 * Server and rsc targets always get `null`: they are the ones that need these.
 */
export async function transformRouteNodes(
  moduleId: string,
  code: string,
  target: "server" | "client",
): Promise<RouteNodeResult | null> {
  if (target !== "client") return null;
  if (!shouldRun(code)) return null;

  const ast = await parse(moduleId, code);
  const imported = tanstackImports(ast);
  if (imported.size === 0) return null;

  const edits: Array<Edit> = [];
  const removed: Array<string> = [];

  walk(ast, (node, stack) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee as Node;
    if (callee?.type !== "Identifier") return;
    const name = String(callee.name);
    if (!ROUTE_FNS.has(name) || !imported.has(name)) return;

    const options = routeOptionsOf(node, stack);
    if (!options) return;

    const properties = (options.properties ?? []) as Array<Node>;
    const doomed = new Set<Node>();
    for (const property of properties) {
      const key = propertyName(property);
      if (!key || !SERVER_ONLY_OPTIONS.has(key)) continue;
      doomed.add(property);
      removed.push(key);
    }
    if (doomed.size) edits.push(...deleteProperties(code, properties, doomed));
  });

  if (edits.length === 0) return null;
  return { code: applyEdits(code, edits), removed };
}
