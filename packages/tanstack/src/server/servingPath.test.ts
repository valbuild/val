/**
 * @jest-environment node
 */
import path from "path";
import { initVal, type ValModules } from "@valbuild/core";

/**
 * What a site evaluates to serve a published page.
 *
 * On Val's hosting a site runs in isolates that are mostly cold, so every
 * module the first request evaluates is paid for again and again: a page that
 * pulled in the Studio's embedded assets (`@valbuild/ui/server`, ~22 MB),
 * TypeScript (~9 MB), sucrase and prettier took seconds before it rendered a
 * single byte, for code that only the Val API, a draft or a save ever runs.
 *
 * An app's `val.server.ts` builds `initValServer` and `initValContent`
 * together, and every page's loader imports it; TanStack Start's route tree
 * imports the API route too. So this drives exactly that module graph -- the
 * package's server entry, the API handler and the MCP endpoint BUILT, a
 * formatter made the way the template makes it, and every reader CALLED on a
 * visitor's (non-draft) request -- and fails naming each heavy module the
 * graph evaluated. `scenarios/measure/coldStart.ts` measures the same thing
 * in a built app; this is the counted half, for CI.
 *
 * Each heavy module is mocked by its RESOLVED path, from the package that
 * imports it, with a factory that records that it ran and then hands back the
 * real module. Jest evaluates a factory on the first `require` of that path,
 * from anywhere, so "recorded" means "evaluated".
 */

/** The packages a visitor's page must not evaluate, by who imports them. */
const HEAVY: { name: string; from: string }[] = [
  // The Studio's assets, behind `createValApiRouter`.
  { name: "@valbuild/ui/server", from: "@valbuild/server" },
  // The compiler, behind the data layer and a save.
  { name: "typescript", from: "@valbuild/server" },
  { name: "sucrase", from: "@valbuild/server" },
  // The app's formatter, which only a save runs.
  { name: "prettier", from: "@valbuild/tanstack" },
  // The MCP tools, which bring the server with them.
  { name: "@valbuild/mcp", from: "@valbuild/tanstack" },
  // The server's root entry: everything above, and the CLI's helpers besides.
  // The readers take what they need from `@valbuild/server/internal`.
  { name: "@valbuild/server", from: "@valbuild/tanstack" },
];

const packageDir = (name: string) =>
  path.dirname(require.resolve(`${name}/package.json`));

const loaded: string[] = [];
for (const { name, from } of HEAVY) {
  const resolved = require.resolve(name, { paths: [packageDir(from)] });
  jest.doMock(resolved, () => {
    loaded.push(name);
    return jest.requireActual(resolved);
  });
}

const { s, c, config } = initVal();

const pageVal = c.define(
  "/content/page.val.ts",
  s.object({ title: s.string() }),
  { title: "Published" },
);
const postsVal = c.define(
  "/content/posts.val.ts",
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
    "/posts/a": c.json(() => Promise.resolve({ default: { title: "Post A" } })),
  },
);
const valModules: ValModules = {
  config,
  modules: [
    { def: async () => ({ default: pageVal }) },
    { def: async () => ({ default: postsVal }) },
  ],
};

/**
 * A deployed site: http mode, where Val's content service holds the patches
 * and says which build is live, so nothing waits on the API being built.
 * (In fs and memory mode `initValServer` builds its server when the app
 * starts, on purpose: see `serverCanStartLazily`.) Nothing here is contacted.
 */
const http = { apiKey: "test-api-key", valSecret: "test-secret" };

/** A visitor: no preview, so no draft and no session to read. */
const visitor = {
  isEnabled: async () => false,
  enable: async () => {},
  disable: async () => {},
};

test("a visitor's page evaluates none of the Studio, the compiler, prettier or MCP", async () => {
  // What `@valbuild/tanstack/server` exports, imported as an app imports it.
  const server = await import("./index");

  // An app's `val.server.ts`: the API, the formatter, the readers -- all built.
  const formatter = server.createPrettierFormatter(() => import("prettier"), {
    projectRoot: process.cwd(),
  });
  const { draftMode } = server.initValServer(valModules, config, {
    draftMode: visitor,
    formatter,
    http,
  });
  server.initValMcp(valModules, config);
  const readers = server.initValContent(config, valModules, {
    draftMode,
    http,
  });

  // ...and every reader a page calls, on a visitor's request.
  expect(await readers.fetchValStega(pageVal)).toEqual({ title: "Published" });
  expect(await readers.fetchValKeyStega(postsVal, "/posts/a")).toEqual({
    title: "Post A",
  });
  expect(await readers.fetchValDraft()).toBeNull();

  expect(loaded).toEqual([]);
});

test("...while the API still loads what it needs", async () => {
  // The control: the mocks above see a load when there is one. Without it the
  // test above would pass on a broken detector.
  const server = await import("./index");
  const { valApiHandler } = server.initValServer(valModules, config, {
    draftMode: visitor,
    sourceFiles: {},
    patchStore: new server.InMemoryPatchStore(),
    unsafelyAllowUnauthenticated: true,
  });
  const res = await valApiHandler(
    new Request("http://localhost/api/val/draft/stat"),
  );
  expect(res.status).toBeLessThan(500);
  expect(loaded).toEqual(
    expect.arrayContaining(["@valbuild/server", "@valbuild/ui/server"]),
  );
});
