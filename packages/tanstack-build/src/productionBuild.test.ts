import { execFileSync } from "child_process";
import path from "path";

/**
 * A published build is a production build, in every sense `vite build` is.
 *
 * Two things said otherwise, and a site built from the starter template showed
 * both at once: the TanStack Devtools panel on every page of a published site.
 *
 * - The devtools have no production no-op. `vite build` loses them because the
 *   `devtools()` plugin in vite.config.ts strips them from the source, and this
 *   builder reads no vite.config. See removeDevtools.ts.
 * - The project's own source got none of Vite's built-ins. `import.meta.env`
 *   held the project's env vars and nothing else, so `PROD` read `undefined`,
 *   and `process.env.NODE_ENV` was left to rolldown, which answers
 *   "development".
 *
 * Split and unsplit both, because the deferred half of a split route is built
 * from the ORIGINAL source (see splitEnvMarkers.test.ts) and the devtools live
 * in a layout's component -- exactly what moves there.
 *
 * The build runs in a child process because `@rolldown/browser` is ESM-only
 * and jest runs CommonJS here. See the probe beside this file.
 */

type Bundle = {
  devtools: boolean;
  routerDevtools: boolean;
  devOnly: boolean;
  mode: string | null;
  nodeEnv: string | null;
  prod: string | null;
  ssr: string | null;
  envLeft: boolean;
};
type Build = { client: Bundle; server: Bundle };
type Probe = { unsplit: Build; split: Build; splitChunks: number };

let probe: Probe;

beforeAll(() => {
  const out = execFileSync(
    path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, "__fixtures__", "productionBuildProbe.ts")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // tsx's WASI warnings share stdout's stream in some shells; take the last
  // line that parses rather than assuming the output is only JSON.
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  probe = JSON.parse(line!) as Probe;
}, 300_000);

test("the stub really did split the layout", () => {
  // Without this the split cases below would be a second unsplit build.
  expect(probe.splitChunks).toBeGreaterThan(0);
});

describe.each(["unsplit", "split"] as const)("%s", (split) => {
  describe.each(["client", "server"] as const)("the %s bundle", (side) => {
    const bundle = () => probe[split][side];

    test("carries no TanStack Devtools", () => {
      expect(bundle().devtools).toBe(false);
    });

    test("nor the router panel only the devtools rendered", () => {
      expect(bundle().routerDevtools).toBe(false);
    });

    test("reads Vite's built-ins as production", () => {
      expect(bundle().mode).toBe("production");
      expect(bundle().prod).toBe("true");
      expect(bundle().devOnly).toBe(false);
      expect(bundle().envLeft).toBe(false);
    });

    test("and NODE_ENV as production, not rolldown's default", () => {
      expect(bundle().nodeEnv).toBe("production");
    });

    test("and SSR as which side it is", () => {
      expect(bundle().ssr).toBe(side === "server" ? "true" : "false");
    });
  });
});
