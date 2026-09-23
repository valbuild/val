// The call-site transform for `createServerFn`.
//
// TanStack Start implements server functions with a Babel pass that rewrites
// `createServerFn` call sites per environment, splitting the implementation
// into a separately-emitted provider module. (It has no `"use server"`
// directive: Start's own docs call that a React convention and tell you not to
// use it. `createServerFn` is the whole API.)
//
// Porting that pass looks expensive and is not, because this builder already
// runs *two* passes over the same file tree (see buildUserApp): one for the
// isolate, one for the browser. The client/server split those passes already
// represent is exactly the split the compiler exists to produce.
//
// So this handles the call-site form, which is the only form there is:
//
//   const greet = createServerFn({ method: 'POST' }).handler(async ({ data }) => ...)
//
// which `createServerFn` itself is built around. Its `handler` takes two
// arguments, and which ones you pass *is* the split:
//
//   handler: (...args) => { const [extractedFn, serverFn] = args; ... }
//
//   client middleware -> options.extractedFn(payload)   // the RPC stub
//   server middleware -> options.serverFn(ctx)          // the real implementation
//
// Server pass, mirroring what Start emits into a provider module:
//
//   const greet_handler = createServerRpc(meta, (opts) => greet.__executeServer(opts))
//   const greet = createServerFn({...}).handler(greet_handler, async ({ data }) => ...)
//   __platformRegister('<id>', greet_handler)
//
// Client pass, which simply never emits the implementation:
//
//   const greet = createServerFn({...}).handler(createClientRpc('<id>'))
//
// The registry is what the shell's replacement resolver reads; see
// packages/shell/src/server-fn-resolver.ts for what it expects to find there
// and why it is the *extracted* function rather than `greet` itself.
import { applyEdits, parse, walk, type Edit, type Node } from "./ast";

/** Virtual module holding the per-build server-function registry. */
export const REGISTRY_ID = "\0platform:server-fns";

/**
 * Populated as each defining module evaluates, read at request time.
 *
 * A mutable module-scoped object rather than something assembled in the entry,
 * because a server function can be declared in any file. Ordering is not a
 * concern: the whole user app is a single chunk (asserted in buildUserApp), so
 * every module has evaluated long before a request arrives.
 */
export const REGISTRY_SOURCE = `
export const __serverFns = {}
export function __register(id, fn) { __serverFns[id] = fn }
`;

/** Re-exported from the entry so the shell can reach it across the boundary. */
/** Cheap pre-filter for "does this module define a server function". */
export const hasServerFn = (code: string) => code.includes("createServerFn");

/**
 * The entry for the RSC build.
 *
 * NOT the app. Under Start's RSC mode the `rsc` environment is the
 * *server-function provider* -- `createStartHandler` forwards every server
 * function call to it -- and that is the only job the bundle has here, because
 * `renderServerComponent` is not supported yet.
 *
 * Building the app entry instead compiles the whole route tree under the
 * `react-server` condition, where React has no hooks and no `createContext`.
 * That works for a fixture with two components and fails for anything with a
 * router in it: the first symptom is `createContext is not a function`, thrown
 * from inside a vendor chunk, on the first server-function call.
 *
 * So the entry imports only the modules that register server functions. Each
 * one registers itself as a side effect (see the transform below), and whatever
 * they pull in comes with them -- including client components, which are
 * replaced by reference stubs before this build sees them.
 */
export function rscEntrySource(files: Record<string, string>) {
  const modules = Object.keys(files)
    .filter((path) => /\.(tsx?|jsx?)$/.test(path) && hasServerFn(files[path]!))
    .sort();

  return (
    modules.map((path) => `import ${JSON.stringify(`./${path}`)}\n`).join("") +
    REGISTRY_REEXPORT
  );
}

export const REGISTRY_REEXPORT = `\nexport { __serverFns } from ${JSON.stringify(REGISTRY_ID)}\n`;

const SERVER_RPC = "@tanstack/react-start/server-rpc";
const CLIENT_RPC = "@tanstack/react-start/client-rpc";

interface Site {
  id: string;
  /** The variable the call is assigned to; the extracted fn is named after it. */
  variableName: string;
  handlerName: string;
  /** Source range of the handler's first argument -- the implementation. */
  argStart: number;
  argEnd: number;
  /** Source range of the whole `const x = ...` statement. */
  declStart: number;
  declEnd: number;
}

/**
 * Ids must be identical across the two passes, since one produces the registry
 * key and the other the URL that looks it up. Derived from the module id and
 * the variable name, both of which are pass-independent.
 *
 * Readable rather than hashed, which is a deliberate spike choice: it makes a
 * failed lookup self-explanatory. It also puts source paths in a public URL,
 * so a real implementation should hash this -- the only property the rest of
 * the system depends on is determinism.
 */
function makeId(moduleId: string, variableName: string, seen: Set<string>) {
  const base = `${moduleId}--${variableName}`
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^_+/, "");
  let id = base;
  let n = 1;
  while (seen.has(id)) id = `${base}_${++n}`;
  seen.add(id);
  return id;
}

/**
 * True for `createServerFn(...)` and any chain built on it --
 * `.validator(...)`, `.middleware([...])` and so on.
 */
function isCreateServerFnChain(node: Node | null | undefined): boolean {
  let current = node;
  while (current && current.type === "CallExpression") {
    const callee = current.callee as Node;
    if (callee?.type === "Identifier" && callee.name === "createServerFn")
      return true;
    if (callee?.type === "MemberExpression") {
      current = callee.object as Node;
      continue;
    }
    return false;
  }
  return false;
}

function findSites(
  ast: Node,
  moduleId: string,
  code: string,
  seen: Set<string>,
) {
  const sites: Array<Site> = [];
  const names = new Set<string>();

  walk(ast, (node, stack) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee as Node;
    if (callee?.type !== "MemberExpression") return;
    if ((callee.property as Node)?.name !== "handler") return;
    if (!isCreateServerFnChain(callee.object as Node)) return;

    const arg = (node.arguments as Array<Node>)?.[0];
    if (!arg) {
      throw new Error(
        `${moduleId}: createServerFn().handler() must be called with a function.`,
      );
    }

    // The extracted function has to reference the variable to reach
    // __executeServer, so an unassigned call has nothing to hang off. Start
    // enforces the same rule, with the same reasoning.
    const declarator = [...stack]
      .reverse()
      .find((parent) => parent.type === "VariableDeclarator");
    const declarationIndex = stack
      .map((parent) => parent.type)
      .lastIndexOf("VariableDeclaration");
    if (
      !declarator ||
      declarationIndex === -1 ||
      (declarator.id as Node)?.type !== "Identifier"
    ) {
      throw new Error(
        `${moduleId}: createServerFn() must be assigned to a plain \`const\` variable ` +
          `(found ${declarator ? "a destructuring pattern" : "an unassigned call"}).`,
      );
    }

    // `export const greet = ...` is an ExportNamedDeclaration *wrapping* the
    // VariableDeclaration, so the declaration's own start is after the `export`
    // keyword. Inserting there would put the extracted const between `export`
    // and `const` -- which parses fine, exports the wrong binding, and shows up
    // as "greet is not exported by src/api.ts" two modules away.
    const parent = stack[declarationIndex - 1];
    const statement =
      parent?.type === "ExportNamedDeclaration"
        ? parent
        : stack[declarationIndex]!;

    const variableName = (declarator.id as Node).name as string;
    let handlerName = `${variableName}_createServerFn_handler`;
    while (names.has(handlerName)) handlerName += "_";
    names.add(handlerName);

    sites.push({
      id: makeId(moduleId, variableName, seen),
      variableName,
      handlerName,
      argStart: arg.start,
      argEnd: arg.end,
      declStart: statement.start,
      declEnd: statement.end,
    });
  });

  return sites;
}

export interface TransformResult {
  code: string;
  ids: Array<string>;
}

/**
 * Rewrites one module for one target. Returns `null` when the module declares
 * no server functions, so the caller can leave it untouched.
 */
export async function transformServerFns(
  moduleId: string,
  code: string,
  target: "server" | "client",
  seen: Set<string>,
): Promise<TransformResult | null> {
  // Cheap bail-out before paying for a parse: the overwhelming majority of a
  // project's modules never mention this.
  if (!code.includes("createServerFn")) return null;

  const ast = await parse(moduleId, code);
  const sites = findSites(ast, moduleId, code, seen);
  if (sites.length === 0) return null;

  const edits: Array<Edit> = [];

  for (const site of sites) {
    if (target === "server") {
      const meta = JSON.stringify({
        id: site.id,
        name: site.variableName,
        filename: moduleId,
      });
      edits.push({
        start: site.declStart,
        end: site.declStart,
        text:
          `const ${site.handlerName} = __platformServerRpc(${meta}, ` +
          `(opts) => ${site.variableName}.__executeServer(opts));\n`,
      });
      // Keep the implementation, and pass the extracted fn alongside it.
      edits.push({
        start: site.argStart,
        end: site.argStart,
        text: `${site.handlerName}, `,
      });
      edits.push({
        start: site.declEnd,
        end: site.declEnd,
        text: `\n__platformRegister(${JSON.stringify(site.id)}, ${site.handlerName});`,
      });
    } else {
      // Drop the implementation entirely. Whatever it referenced and nothing
      // else does goes with it when rolldown shakes the graph.
      edits.push({
        start: site.argStart,
        end: site.argEnd,
        text: `__platformClientRpc(${JSON.stringify(site.id)})`,
      });
    }
  }

  const out = applyEdits(code, edits);

  const prelude =
    target === "server"
      ? `import { createServerRpc as __platformServerRpc } from ${JSON.stringify(SERVER_RPC)};\n` +
        `import { __register as __platformRegister } from ${JSON.stringify(REGISTRY_ID)};\n`
      : `import { createClientRpc as __platformClientRpc } from ${JSON.stringify(CLIENT_RPC)};\n`;

  return { code: prelude + out, ids: sites.map((site) => site.id) };
}
