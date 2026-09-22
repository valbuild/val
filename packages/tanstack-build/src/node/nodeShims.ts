// A CJS-to-ESM bridge for Node builtins, so a CommonJS dependency can be
// layered at all.
//
// The isolate HAS the builtins. `/__api/builtins` on the loader loads a Dynamic
// Worker and imports each one: at compatibility date 2026-08-20 all 48
// candidates resolve, under both `fs` and `node:fs`, with real export counts.
// What it does not have is `require`. A package that reaches for a builtin
// through CJS -- `require("fs")`, which is what the TypeScript compiler does,
// and `@valbuild/server` embeds the TypeScript compiler because Val's content
// is `.val.ts` source and applying a patch means rewriting a TypeScript AST --
// compiles to rolldown's `__require` against an external, and that is a startup
// crash:
//
//   Calling `require` for "fs" in an environment that doesn't expose the
//   `require` function
//
// Routing the specifier to a bundled module that does `import * as ns from
// 'node:fs'` turns the require into a static ESM import the isolate answers.
// That is all this file is now.
//
// It used to be something else, and the difference is worth stating because the
// old framing is what made `--node-shims` look like a hole in the import audit.
// The premise was that the isolate lacked these, so the file carried a memory
// filesystem, a hand-written `os`, and a dozen modules whose every access threw
// by name. Nobody had asked the isolate. Once asked, the stubs turned out to be
// worse answers than the runtime's own -- and a forwarding bridge is not a hole
// in an audit whose job is to catch a specifier that will not resolve.
//
// What this is still NOT is a filesystem. `node:fs` in a Worker has no disk
// behind it, so a package that genuinely reads or writes fails at the call.
// That is the honest outcome, and it is the same outcome the memory filesystem
// gave for every path it had not been seeded with.

/**
 * Shims that are NOT a re-export of the real builtin.
 *
 * There used to be a long list here: a memory filesystem, a stubbed `os`, and a
 * dozen modules whose every access threw by name. All of it rested on this
 * file's original premise -- that the isolate does not provide these. It does.
 * `/__api/builtins` on the loader asks a Dynamic Worker directly, and at
 * compatibility date 2026-08-20 all 48 candidates import under both spellings,
 * `fs` with 105 exports. The stubs were answering questions the runtime could
 * answer better, and they were answering some of them WRONG: a hand-written
 * `os` grew a member at a time, each discovered as `X is not a function` at
 * runtime.
 *
 * So everything that can be is now a re-export (REEXPORT, below), and this is
 * what is left.
 */
export const NODE_SHIMS: Record<string, string> = {
  // A pure-JS posix implementation rather than a re-export of `node:path`.
  //
  // The runtime does provide `node:path`, but a re-export has to guess how its
  // namespace is shaped -- named exports, a CJS default, or both -- and a wrong
  // guess does not fail at build time. It fails as `ue.join is not a function`
  // from inside a minified dependency, with nothing naming the shim. Bundling
  // an implementation removes the question: there is no interop left to get
  // wrong. Posix only, which is all a Worker ever sees.
  path: `
const sep = '/'
const delimiter = ':'
export function normalize(p) {
  const absolute = String(p).startsWith('/')
  const parts = []
  for (const part of String(p).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop()
      else if (!absolute) parts.push('..')
    } else parts.push(part)
  }
  const joined = parts.join('/')
  if (absolute) return '/' + joined
  return joined || '.'
}
export function join(...parts) {
  const joined = parts.filter((part) => part !== '' && part != null).join('/')
  return joined === '' ? '.' : normalize(joined)
}
export function isAbsolute(p) { return String(p).startsWith('/') }
export function resolve(...parts) {
  let resolved = ''
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (!part) continue
    resolved = resolved ? part + '/' + resolved : String(part)
    if (isAbsolute(part)) break
  }
  if (!isAbsolute(resolved)) resolved = '/' + resolved
  return normalize(resolved)
}
export function dirname(p) {
  const s = String(p)
  const at = s.lastIndexOf('/')
  if (at === -1) return '.'
  if (at === 0) return '/'
  return s.slice(0, at)
}
export function basename(p, ext) {
  const s = String(p)
  let base = s.slice(s.lastIndexOf('/') + 1)
  if (ext && base.endsWith(ext) && base !== ext) base = base.slice(0, -ext.length)
  return base
}
export function extname(p) {
  const base = basename(p)
  const at = base.lastIndexOf('.')
  return at <= 0 ? '' : base.slice(at)
}
export function relative(from, to) {
  const a = resolve(from).split('/').filter(Boolean)
  const b = resolve(to).split('/').filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}
export function parse(p) {
  const dir = dirname(p)
  const base = basename(p)
  const ext = extname(p)
  return { root: isAbsolute(p) ? '/' : '', dir, base, ext, name: ext ? base.slice(0, -ext.length) : base }
}
export function format(o) {
  const base = o.base || (o.name || '') + (o.ext || '')
  return o.dir ? join(o.dir, base) : base
}
export function toNamespacedPath(p) { return p }
const posix = { sep, delimiter, normalize, join, isAbsolute, resolve, dirname, basename, extname, relative, parse, format, toNamespacedPath }
posix.posix = posix
posix.win32 = posix
export { sep, delimiter, posix }
export const win32 = posix
export default posix
`,
};

/**
 * Builtins the isolate provides, re-exported through a bundled module.
 *
 * Not a stub -- these forward to the real thing. The reason they need a module
 * at all is that a package requiring a builtin through CJS (`require("fs")`,
 * which is what the TypeScript compiler does) becomes rolldown's `__require`
 * against an external, and that throws at startup:
 *
 *   Calling `require` for "fs" in an environment that doesn't expose the
 *   `require` function
 *
 * Routing the specifier to a bundled module turns that CJS require into a
 * static ESM import of `node:fs`, which the isolate answers. That is the whole
 * job: this is a CJS-to-ESM bridge, not a substitute runtime.
 *
 * The export names are ENUMERATED FROM NODE at build time rather than listed by
 * hand. `export * from 'node:crypto'` cannot be checked against an external --
 * rolldown does not know what the isolate's `node:crypto` exports, so a named
 * import of it fails the build with "createPublicKey is not exported". Listing
 * names by hand works and is endless: `fileURLToPath`, then `Module`, then
 * `createPublicKey`, each discovered by a failed build.
 *
 * This CLI runs on Node, so the real module is right there to ask. A name Node
 * has and the isolate does not yields `undefined`, which is what the real
 * module would give.
 *
 * The list is every builtin the platform's dependencies have been seen to
 * import, minus `path` (bundled above) -- NOT every builtin that exists.
 * Importing one here costs a module load in this CLI, and the deprecated and
 * experimental ones (`sys`, `wasi`, `repl`, `domain`, `trace_events`) print
 * warnings for a name nothing emits. Add a name when something emits it; the
 * audit will say so.
 */
export const REEXPORT = [
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "constants",
  "crypto",
  "diagnostics_channel",
  "dns",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "timers",
  "timers/promises",
  "tls",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
];

/**
 * The re-export shims, built by asking Node what each builtin exports.
 *
 * Built on demand rather than at module scope, which it used to be. A top-level
 * `await import('node:fs')` cannot be compiled to CommonJS at all -- the build
 * of this package stops with INVALID_TLA_FORMAT -- and it was fine only for as
 * long as this file was loaded as source by a runner that strips types.
 *
 * Memoised, so the twenty-odd dynamic imports happen once per process however
 * many targets a layer build has.
 */
let shims: Promise<Record<string, string>> | null = null;

async function buildShims(): Promise<Record<string, string>> {
  const all: Record<string, string> = { ...NODE_SHIMS };
  for (const name of REEXPORT) {
    const real: Record<string, unknown> = await import(`node:${name}`);
    const names = Object.keys(real).filter(
      (key) => key !== "default" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key),
    );
    // `ns.default ?? ns`, because the isolate's builtins are not all shaped like
    // Node's. workerd's `node:path` exposes its functions on the DEFAULT export
    // and not as named ones, so `import * as ns from 'node:path'; ns.join` is
    // undefined -- which surfaced as a minified `I.join is not a function` from
    // inside Val, with nothing pointing at the shim.
    // Three sources, in order: the CJS default, the namespace, and -- for crypto
    // -- the WEB global. This is the third time a re-export has been wrong about
    // a builtin's shape: `path.join` was undefined (fixed by bundling path
    // outright), then `crypto.randomUUID` was, because a Worker puts Web Crypto
    // on `globalThis.crypto` and does not necessarily mirror every name onto
    // `node:crypto`. Each failure surfaces as `X is not a function` from inside
    // minified dependency code, naming nothing.
    //
    // `pick` binds only what it takes from the web global, and only when it is a
    // function: `globalThis.crypto.subtle` is an object, and calling `.bind` on
    // it is a startup crash of its own.
    const isCrypto = name === "crypto";
    all[name] =
      [
        `import * as ns from 'node:${name}'`,
        `const mod = ns.default ?? ns`,
        isCrypto
          ? `const web = globalThis.crypto
const pick = (key) => {
  const own = mod[key] ?? ns[key]
  if (own !== undefined) return own
  const fromWeb = web?.[key]
  return typeof fromWeb === 'function' ? fromWeb.bind(web) : fromWeb
}`
          : `const pick = (key) => mod[key] ?? ns[key]`,
        isCrypto
          ? `export default new Proxy(mod, { get: (t, p) => t[p] ?? pick(p) })`
          : `export default mod`,
        ...names.map(
          (exported) =>
            `export const ${exported} = pick(${JSON.stringify(exported)})`,
        ),
      ].join("\n") + "\n";
  }
  return all;
}

/** Every shim, hand-written and generated, by builtin name. */
export function nodeShimSources(): Promise<Record<string, string>> {
  if (!shims) shims = buildShims();
  return shims;
}

/**
 * The resolved-id prefix for a shim module. Exported so a test can ask the
 * resolver what it does with a shim's own imports -- see scripts/shims-test.ts.
 */
export const SHIM_PREFIX = "\0platform-node-shim:";
const PREFIX = SHIM_PREFIX;

/**
 * Routes a builtin specifier to a bundled module that forwards to the real one.
 *
 * Bundled rather than external on purpose, and the reason is the whole point of
 * the file: an external leaves the CJS `require("fs")` as rolldown's
 * `__require`, which an isolate with no `require` cannot answer. A bundled
 * module turns it into an ESM import the isolate can.
 */
export async function nodeShims(enabled: boolean) {
  // Awaited HERE rather than inside the hooks below, so `resolveId` and `load`
  // stay synchronous: they are called once per module of every dependency in
  // the layer, and the answer is the same every time.
  const sources = await nodeShimSources();
  return {
    name: "platform:node-shims",
    resolveId(source: string, importer: string | undefined) {
      // Already one of ours, by its resolved id.
      if (source.startsWith(PREFIX)) return source;
      // `enabled` is the WORKER target. The browser has no node builtins to
      // bridge to, so a package reaching for one there has to reach the audit.
      if (!enabled) return null;
      /*
       * A SHIM reaching for the real builtin. External, always.
       *
       * Without this the rule below catches it and hands the shim back its own
       * id, so every re-export shim imports itself: `import * as ns from
       * 'node:stream'` inside the `stream` shim resolves to the `stream` shim.
       * `const mod = ns.default ?? ns` then reads its own uninitialised
       * binding, and the minifier -- which can see that `ns.default` IS `mod`
       * -- emits `const mod = mod ?? ns` verbatim. That is a TDZ, and it threw
       * on the first request that touched TanStack's SSR path:
       *
       *   ReferenceError: Cannot access 'fs' before initialization
       *
       * naming a minified identifier that has nothing to do with `fs`.
       *
       * It was also silently wrong everywhere it did not throw: a shim that
       * imports itself never reaches the builtin, so `pick()` answers
       * `undefined` for every name. That is why `crypto.randomUUID` needed a
       * Web Crypto fallback to work -- the `node:crypto` half was never
       * reaching `node:crypto`.
       *
       * Safe as an external: every name in REEXPORT is in the audit's
       * RUNTIME_BUILTINS, so the emitted `node:...` specifier is one the
       * isolate answers.
       */
      if (importer?.startsWith(PREFIX)) {
        return { id: source, external: true };
      }
      const name = source.replace(/^node:/, "");
      return name in sources ? `${PREFIX}${name}` : null;
    },
    load(id: string) {
      if (!id.startsWith(PREFIX)) return null;
      return sources[id.slice(PREFIX.length)]!;
    },
  };
}
