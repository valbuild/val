/**
 * Builds the same project twice — with a splitter and without — and reports
 * whether a `<ClientOnly>` child survived into the server bundle.
 *
 * A separate process because `@rolldown/browser` is ESM-only and jest runs
 * CommonJS here; `require(esm)` needs Node 24.9+. `tsx` runs this as real ESM.
 * The assertions stay in the test — this only reports.
 */
import { buildUserApp } from "../build";
import type { BuildTarget } from "../contract";
import type { RouteSplitter } from "../routeSplit";

/**
 * The splitter's contract, without TanStack's splitter.
 *
 * `@tanstack/router-plugin` is Babel-based and an optional peer, so a test
 * needing the real one would be testing something this package does not depend
 * on. What matters is the SHAPE: the reference half points at
 * `?tsr-split=component` and the deferred half carries the component's code.
 */
const splitter: RouteSplitter = {
  reference(id) {
    const file = id.slice(id.lastIndexOf("/") + 1);
    return {
      code:
        `import { lazyRouteComponent } from "@tanstack/react-router";\n` +
        `export const Route = {\n` +
        `  component: lazyRouteComponent(() => import("./${file}?tsr-split=component")),\n` +
        `};\n`,
    };
  },
  virtual(_id, code) {
    // The real one keeps only the named targets. Keeping the whole module is
    // the stricter case: the marker is here either way.
    return { code };
  },
};

/** The smallest platform a build will accept. */
const target: BuildTarget = {
  base: {
    rev: "base",
    shellRev: "shell",
    rscShellRev: "rsc",
    modules: {
      react: "react",
      "react/jsx-runtime": "jsx-runtime",
      "react-dom": "react-dom",
      "@tanstack/react-router": "tanstack-react-router",
      "@tanstack/react-start": "tanstack-react-start",
    },
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
  project: { rev: null, rsc: false, modules: {}, css: {}, workerOnly: [] },
};

/** The child of a `<ClientOnly>`, which the server transform drops. */
const CHILD = "only-in-a-browser";

const files = {
  "src/app.tsx": `
import { Route } from "./routes/index.tsx";
export default { routes: [{ path: "/", component: Route.component }] };
`,
  "src/routes/index.tsx": `
import { ClientOnly } from "@tanstack/react-router";

export const Route = {
  component: function Page() {
    return (
      <ClientOnly fallback={<span>loading</span>}>
        <em>${CHILD}</em>
      </ClientOnly>
    );
  },
};
`,
};

const serverText = (built: {
  serverCode: string;
  serverChunks?: Record<string, string>;
}) => built.serverCode + Object.values(built.serverChunks ?? {}).join("\n");

async function main() {
  const unsplit = await buildUserApp({ files, target });
  const split = await buildUserApp({ files, target, routeSplitter: splitter });

  console.log(
    JSON.stringify({
      child: CHILD,
      unsplitKeepsChild: serverText(unsplit).includes(CHILD),
      splitKeepsChild: serverText(split).includes(CHILD),
      // Proof the stub actually deferred something: without a split chunk the
      // comparison above would be one unsplit build against another.
      splitChunks: Object.keys(split.serverChunks ?? {}).length,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
