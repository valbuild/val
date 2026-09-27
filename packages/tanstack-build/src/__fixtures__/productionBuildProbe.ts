/**
 * Builds a project the way the starter template is written -- devtools
 * rendered unconditionally in a layout, a debug panel gated on `import.meta.env`
 * -- with a splitter and without, and reports what reached each bundle.
 *
 * A separate process for the reason splitEnvMarkersProbe.ts gives:
 * `@rolldown/browser` is ESM-only and jest runs CommonJS here. The assertions
 * stay in the test -- this only reports.
 */
import { buildUserApp } from "../build";
import type { BuildTarget } from "../contract";
import type { RouteSplitter } from "../routeSplit";

/** The splitter's contract, without TanStack's. See splitEnvMarkersProbe.ts. */
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
    return { code };
  },
};

/**
 * The smallest platform a build will accept. The devtools packages are not in
 * it, as they are not in the real one: a project layers them itself.
 */
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
  project: {
    rev: "project",
    rsc: false,
    modules: {
      "@tanstack/react-devtools": "tanstack-react-devtools",
      "@tanstack/react-router-devtools": "tanstack-react-router-devtools",
    },
    css: {},
    workerOnly: [],
  },
};

/**
 * Text behind `import.meta.env.DEV`. rolldown folds the gate to `false` and
 * drops the element with it, so it is absent only when DEV was substituted --
 * `minify` is off, so a gate on anything else would leave the text in place.
 */
const DEV_ONLY = "rendered-only-in-dev";

const files = {
  "src/app.tsx": `
import { Route } from "./routes/_site.tsx";
export default { routes: [{ path: "/", component: Route.component }] };
`,
  "src/routes/_site.tsx": `
import { Outlet } from "@tanstack/react-router";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

export const Route = {
  component: function SiteLayout() {
    const { PROD, SSR } = import.meta.env;
    return (
      <main
        data-mode={import.meta.env.MODE}
        data-node-env={process.env.NODE_ENV}
        data-prod={PROD}
        data-ssr={SSR}
      >
        <Outlet />
        {import.meta.env.DEV && <em>${DEV_ONLY}</em>}
        <TanStackDevtools
          config={{ position: "bottom-left" }}
          plugins={[
            { name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> },
          ]}
        />
      </main>
    );
  },
};
`,
};

type Built = Awaited<ReturnType<typeof buildUserApp>>;

const clientText = (built: Built) =>
  built.clientCode + Object.values(built.clientChunks ?? {}).join("\n");
const serverText = (built: Built) =>
  built.serverCode + Object.values(built.serverChunks ?? {}).join("\n");

function report(built: Built) {
  const out: Record<string, unknown> = {};
  const texts: Array<[string, string]> = [
    ["client", clientText(built)],
    ["server", serverText(built)],
  ];
  for (const [name, text] of texts) {
    out[name] = {
      devtools: /react-devtools|TanStackDevtools/.test(text),
      routerDevtools: /react-router-devtools|TanStackRouterDevtoolsPanel/.test(
        text,
      ),
      devOnly: text.includes(DEV_ONLY),
      // What each read was replaced with, or `null` when it was not replaced.
      mode: /"data-mode": "([^"]*)"/.exec(text)?.[1] ?? null,
      nodeEnv: /"data-node-env": "([^"]*)"/.exec(text)?.[1] ?? null,
      prod: /"PROD": (true|false)/.exec(text)?.[1] ?? null,
      ssr: /"SSR": (true|false)/.exec(text)?.[1] ?? null,
      envLeft: /import\.meta\.env|process\.env/.test(text),
    };
  }
  return out;
}

async function main() {
  const unsplit = await buildUserApp({ files, target });
  const split = await buildUserApp({ files, target, routeSplitter: splitter });
  console.log(
    JSON.stringify({
      unsplit: report(unsplit),
      split: report(split),
      splitChunks: Object.keys(split.clientChunks ?? {}).length,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
