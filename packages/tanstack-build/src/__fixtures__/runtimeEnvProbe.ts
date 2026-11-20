/**
 * Builds a project that reads `import.meta.env` every way a project does, then
 * RUNS both bundles -- the browser's with the `<head>` global the platform's
 * loader writes, the server's with `process.env` as an isolate has it -- and
 * reports what each read.
 *
 * Run rather than searched, because the failure this guards against is not a
 * string in the output: an `import.meta.env` replaced with an identifier that
 * nothing then imports is a ReferenceError the first time the page renders.
 * The project has no JSX and imports nothing, so its bundle imports nothing
 * either and can be loaded from a `data:` URL as it is.
 *
 * A separate process for the reason splitEnvMarkersProbe.ts gives:
 * `@rolldown/browser` is ESM-only and jest runs CommonJS here.
 */
import { buildUserApp } from "../build";
import type { BuildTarget } from "../contract";

const target: BuildTarget = {
  base: {
    rev: "base",
    shellRev: "shell",
    rscShellRev: "rsc",
    modules: {},
    rscModules: {},
    paths: {
      baseFromProject: "../vendor/",
      projectVendorDir: "pvendor",
      rscVendorBase: "../vendor-rsc/",
      rscRuntimeSpecifier: "@tanstack/react-start/rsc",
      rscRuntimePath: "./runtime.js",
      flightServer: "@vitejs/plugin-rsc/vendor/react-server-dom/server.edge",
      serverFnBase: "/_serverFn/",
    },
  },
  project: {
    rev: null,
    rsc: false,
    modules: {},
    css: {},
    workerOnly: [],
  },
};

const files = {
  "src/app.tsx": `
import { read } from "./read";
// At the top level, which runs when the module is evaluated: before any
// request, so before anything a request handler could set.
const atTop = import.meta.env.PUBLIC_TOP;
export default { atTop, read };
`,
  "src/read.ts": `
export function read() {
  const { PUBLIC_DESTRUCTURED, MODE } = import.meta.env;
  return {
    direct: import.meta.env.PUBLIC_DIRECT,
    destructured: PUBLIC_DESTRUCTURED,
    node: process.env.PUBLIC_NODE,
    notPublic: import.meta.env.SERVER_ONLY,
    // No guard: in the browser there is no \`process\`, and this must not throw.
    notPublicNode: process.env.SERVER_ONLY,
    mode: MODE,
    ssr: import.meta.env.SSR,
    inlined: import.meta.env.PUBLIC_INLINED,
    inlinedNode: process.env.PUBLIC_INLINED,
    buildOnly: import.meta.env.PUBLIC_BUILD_ONLY,
    buildOnlyNode: process.env.PUBLIC_BUILD_ONLY,
    // Given at build time and not PUBLIC_: read by name, on both sides.
    buildServerOnly: process.env.BUILD_SERVER_ONLY,
    buildServerOnlyMeta: import.meta.env.BUILD_SERVER_ONLY,
    // Read off the object, not by its dotted name.
    nodeEnv: (() => {
      const { NODE_ENV } = process.env;
      return NODE_ENV;
    })(),
  };
}
`,
};

/** What the platform hands each side, the same names on both. */
const RUNTIME = {
  PUBLIC_TOP: "top",
  PUBLIC_DIRECT: "direct",
  PUBLIC_DESTRUCTURED: "destructured",
  PUBLIC_NODE: "node",
  PUBLIC_INLINED: "from-runtime",
  SERVER_ONLY: "server-only",
};

type App = { atTop: unknown; read: () => Record<string, unknown> };

async function run(code: string): Promise<Record<string, unknown>> {
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const mod: { default: App } = await import(url);
  return { atTop: mod.default.atTop, ...mod.default.read() };
}

async function main() {
  const built = await buildUserApp({
    files,
    target,
    // UNREAD_SERVER_ONLY is read by nothing, so it must be in nothing.
    // PUBLIC_BUILD_ONLY is set at build time and not at runtime.
    env: {
      PUBLIC_INLINED: "from-build",
      PUBLIC_BUILD_ONLY: "build-only",
      BUILD_SERVER_ONLY: "build-server-secret",
      UNREAD_SERVER_ONLY: "unread-build-value",
    },
  });

  // The browser: the loader's `<head>` script has run, and it hands over
  // PUBLIC_ names only -- SERVER_ONLY is here to show the bundle would not
  // read it even if it were.
  Reflect.set(globalThis, "__PLATFORM_PUBLIC_ENV", RUNTIME);
  const savedProcess = globalThis.process;
  // As in a browser, where there is no `process` at all.
  Reflect.deleteProperty(globalThis, "process");
  let client: Record<string, unknown>;
  try {
    client = await run(built.clientCode);
  } finally {
    globalThis.process = savedProcess;
    Reflect.deleteProperty(globalThis, "__PLATFORM_PUBLIC_ENV");
  }

  // The server: an isolate's env is its `process.env`.
  Object.assign(process.env, RUNTIME);
  const server = await run(built.serverCode);

  console.log(
    JSON.stringify({
      client,
      server,
      identifierLeft: /__PLATFORM_RUNTIME_ENV__/.test(
        built.clientCode + built.serverCode,
      ),
      // A value given to the build that is not PUBLIC_: what this guards is
      // that it is not inlined into the browser's bundle, where anything is
      // public. (A runtime one never is: it is not in the build at all.)
      clientHasServerOnly: built.clientCode.includes("build-server-secret"),
      unreadInlinedAnywhere: (built.clientCode + built.serverCode).includes(
        "unread-build-value",
      ),
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
