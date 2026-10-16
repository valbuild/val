import { parseBuildTarget } from "./protocol";

/**
 * `GET /v1/build-target` as the CLI reads it.
 *
 * `z.object` drops a key it does not name, so a field the platform added and
 * this schema did not declare simply never arrives -- with no error, and with
 * every check that reads it quietly off. `pins` and `exports` were that field
 * for one release candidate: `val publish` skipped the version check on every
 * publish while saying the platform had not sent anything.
 */
const target = {
  base: {
    rev: "base",
    shellRev: "shell",
    rscShellRev: "rsc",
    modules: { react: "react" },
    rscModules: {},
    paths: {
      baseFromProject: "../vendor/",
      projectVendorDir: "pvendor",
      rscVendorBase: "../vendor-rsc/",
      rscRuntimeSpecifier: "@tanstack/react-start/rsc",
      rscRuntimePath: "./runtime.js",
      flightServer: "x",
      serverFnBase: "/_serverFn/",
    },
  },
  project: { rev: null, rsc: false, modules: {}, css: {}, workerOnly: [] },
};

test("the platform's pins and exports survive the parse", () => {
  const pins = { "@tanstack/start-server-core": "1.169.39" };
  const exports = {
    worker: { react: ["useState"] },
    browser: { react: ["useState"] },
  };
  const parsed = parseBuildTarget({
    ...target,
    base: { ...target.base, pins, exports },
  });
  expect(parsed.base.pins).toEqual(pins);
  expect(parsed.base.exports).toEqual(exports);
});

test("a platform that predates them still parses, without them", () => {
  const parsed = parseBuildTarget(target);
  expect(parsed.base.pins).toBeUndefined();
  expect(parsed.base.exports).toBeUndefined();
});
