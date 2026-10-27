// `"use client"` boundaries.
//
// A server component cannot render a client component -- it has no hooks, no
// state, no effects. What it emits instead is a *pointer*: "component `Counter`
// from module `c0`". Something on the other side has to turn that pointer back
// into real code.
//
// Normally the bundler owns that map, because only it knows which chunk a
// module ended up in. That is the expensive part of RSC bundler integration,
// and it is the one thing this architecture makes trivial: there is exactly one
// client chunk, so every client reference resolves to the same module and the
// map is a lookup by name.
//
// Three targets, three treatments of the same file:
//
//   rsc     the module is replaced by reference stubs; its real code, and
//           anything only it imported, never enters the server bundle
//   ssr     kept as-is, because SSR renders client components to HTML
//   client  kept as-is, because the browser hydrates them
//
// The ssr and client builds additionally export `__clientModules`, which is
// what the shell's replacement for `virtual:vite-rsc/client-references` reads.
import { parse, type Node } from "./ast";

const DIRECTIVE = /^\s*(['"])use client\1/;

/** Cheap check before paying for a parse. */
export const hasUseClient = (code: string) => DIRECTIVE.test(code);

export interface ClientModule {
  /** Project-relative file path, e.g. `src/components/Counter.tsx`. */
  path: string;
  /** Stable id used in the flight payload and in the lookup map. */
  id: string;
  /** Export names, `default` included. */
  exports: Array<string>;
}

/** Export names of one module, in source order. */
function exportsOf(ast: Node): Array<string> {
  const names: Array<string> = [];

  for (const statement of ast.body as Array<Node>) {
    if (statement.type === "ExportDefaultDeclaration") {
      names.push("default");
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;

    // `export { a, b as c }`
    for (const specifier of (statement.specifiers ?? []) as Array<Node>) {
      const exported = (specifier.exported as Node)?.name;
      if (exported) names.push(String(exported));
    }

    // `export const a = ...`, `export function b() {}`
    const declaration = statement.declaration as Node | null;
    if (!declaration) continue;
    if (declaration.type === "VariableDeclaration") {
      for (const declarator of (declaration.declarations ??
        []) as Array<Node>) {
        // A destructured export has no single name to reference; the flight
        // protocol needs one, so it is not supported rather than silently
        // producing a reference that cannot resolve.
        const id = declarator.id as Node;
        if (id?.type === "Identifier") names.push(String(id.name));
      }
    } else if ((declaration.id as Node)?.name) {
      names.push(String((declaration.id as Node).name));
    }
  }

  return [...new Set(names)];
}

/**
 * Finds every `"use client"` module in the project.
 *
 * Ids are assigned by sorted path rather than by discovery order, so the same
 * project always produces the same ids -- the rsc build writes them into the
 * flight payload and the ssr build writes them into the lookup map, and those
 * are separate passes that must agree.
 */
export async function collectClientModules(
  files: Record<string, string>,
): Promise<Array<ClientModule>> {
  const paths = Object.keys(files)
    .filter((path) => /\.(tsx?|jsx?)$/.test(path) && hasUseClient(files[path]!))
    .sort();

  const modules: Array<ClientModule> = [];
  for (const [index, path] of paths.entries()) {
    const ast = await parse(path, files[path]!);
    const exported = exportsOf(ast);
    if (exported.length === 0) {
      throw new Error(
        `${path}: a "use client" module must export something. ` +
          `Its exports are what a server component can reference.`,
      );
    }
    modules.push({ path, id: `c${index}`, exports: exported });
  }
  return modules;
}

/**
 * The rsc-target replacement for a client module.
 *
 * `registerClientReference` comes from the flight server, which the rsc vendor
 * layer already carries. The first argument is the value a server component
 * would see if it tried to *call* the component -- React replaces it with a
 * throwing proxy, so the mistake surfaces as "cannot be rendered on the server"
 * rather than as a confusing render.
 */
export function clientReferenceStub(
  module: ClientModule,
  /**
   * Where `registerClientReference` comes from, from the build target.
   *
   * A parameter rather than an import for the reason the whole `build-target`
   * chunk exists: reading it from `@valbuild/vendor/externals` at compile time
   * is what made this package buildable only inside the platform's own
   * repository.
   */
  flightServer: string,
) {
  const lines = [
    `import { registerClientReference as __ref } from ${JSON.stringify(flightServer)}`,
  ];
  for (const name of module.exports) {
    const value = `__ref({}, ${JSON.stringify(module.id)}, ${JSON.stringify(name)})`;
    lines.push(
      name === "default"
        ? `export default ${value}`
        : `export const ${name} = ${value}`,
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * What the ssr and client entries append so the reference map can be built.
 *
 * Namespaces rather than lazy importers: the whole app is one chunk, so there
 * is nothing to defer -- the module is already in memory by the time any
 * reference is resolved.
 */
export function clientModuleRegistry(modules: Array<ClientModule>) {
  if (modules.length === 0) return `\nexport const __clientModules = {}\n`;

  const imports = modules
    .map(
      (module, index) =>
        `import * as __c${index} from ${JSON.stringify(module.path)}`,
    )
    .join("\n");
  const entries = modules
    .map((module, index) => `  ${JSON.stringify(module.id)}: __c${index},`)
    .join("\n");

  return `\n${imports}\nexport const __clientModules = {\n${entries}\n}\n`;
}
