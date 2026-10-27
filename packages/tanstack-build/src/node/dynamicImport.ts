/**
 * `import(url)`, out of reach of the CommonJS build.
 *
 * Rollup compiles a dynamic `import(x)` in this package's CJS output to
 * `require(x)`, and `require` does not accept a `file://` URL. So the three
 * places that load a module BY PATH at runtime — a project's Tailwind plugin,
 * and TanStack's two code-splitter internals — failed with
 *
 *     Cannot find module 'file:///…/node_modules/@tailwindcss/typography/src/index.js'
 *
 * naming a file that is plainly there. Nothing caught it before this package
 * moved to npm, because the only thing that had ever loaded this code was a
 * runner that strips types and leaves the ESM alone.
 *
 * `new Function` because the point is to be invisible to the bundler: any
 * spelling rollup can see, it rewrites. Node-only code, so there is no CSP to
 * be hostile to.
 *
 * **Absolute `file://` URLs only.** The function body has no module of its own,
 * so a bare specifier would resolve against the process's working directory
 * rather than against the caller — which is a different module or none at all.
 * A bare specifier stays an ordinary `import()`: `require()` of a package is
 * something Node answers, including for an ESM-only one.
 */
const importByUrl = new Function("url", "return import(url)");

export function dynamicImport(url: string): Promise<unknown> {
  return importByUrl(url);
}
