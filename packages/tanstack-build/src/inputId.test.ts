import { buildInputId } from "./inputId";
import { VAL_SERVER_PATH, rebakeGit, wiredValServer } from "./wire";
import type { BuildInput } from "./build";
import type { BuildTarget } from "./contract";

/**
 * A build is named by what it was built FROM (valbuild/home
 * `docs/hosted-publishing.md`, step 3): the same inputs are the same build,
 * which the platform then never builds twice, and anything that could change
 * a byte of the output is an input.
 */

const target: BuildTarget = {
  base: {
    rev: "base-1",
    shellRev: "shell-1",
    rscShellRev: "rsc-shell-1",
    modules: { react: "react.js" },
    rscModules: {},
    paths: {
      baseFromProject: "../vendor/",
      projectVendorDir: "pvendor/",
      rscVendorBase: "../rsc/",
      rscRuntimeSpecifier: "rsc-runtime",
      rscRuntimePath: "rsc/runtime.js",
      flightServer: "flight.js",
      serverFnBase: "/_server",
    },
  },
  project: { rev: "layer-1", rsc: false, modules: {}, css: {}, workerOnly: [] },
};

const files = {
  "src/routes/index.tsx": "export default function Home() { return 'hi'; }",
  "src/content/home.val.ts":
    'export default c.define("/home", s.string(), "Hello");',
  [VAL_SERVER_PATH]: wiredValServer({
    project: "demo",
    loader: "https://loader.example",
  }),
};

const input = (over: Partial<BuildInput> = {}): BuildInput => ({
  files,
  target,
  ...over,
});

describe("a build's id", () => {
  test("is the same for the same inputs", async () => {
    expect(await buildInputId(input())).toBe(await buildInputId(input()));
    expect(await buildInputId(input())).toMatch(/^[0-9a-f]{32}$/);
  });

  test("whatever order the files are listed in", async () => {
    const reversed = Object.fromEntries(Object.entries(files).reverse());
    expect(await buildInputId(input({ files: reversed }))).toBe(
      await buildInputId(input()),
    );
  });

  test("changes with the code", async () => {
    const changed = {
      ...files,
      "src/routes/index.tsx":
        "export default function Home() { return 'bye'; }",
    };
    expect(await buildInputId(input({ files: changed }))).not.toBe(
      await buildInputId(input()),
    );
  });

  test("changes with the content, which the bundle holds", async () => {
    const changed = {
      ...files,
      "src/content/home.val.ts":
        'export default c.define("/home", s.string(), "Hej");',
    };
    expect(await buildInputId(input({ files: changed }))).not.toBe(
      await buildInputId(input()),
    );
  });

  test("changes with the embedded source record", async () => {
    const projectSource = { ...files, "src/extra.ts": "export {}" };
    expect(await buildInputId(input({ projectSource }))).not.toBe(
      await buildInputId(input()),
    );
  });

  test("does NOT change with the job it was built for", async () => {
    // Every Studio build bakes its job into val.server.ts. A job id in the
    // build's name would make every build unique, and nothing could ever be
    // reused.
    const forJob = (job: string) => ({
      ...files,
      ...rebakeGit(files, null, job),
    });
    expect(await buildInputId(input({ files: forJob("J1") }))).toBe(
      await buildInputId(input({ files: forJob("J2") })),
    );
    expect(
      await buildInputId(
        input({ files: forJob("J1"), projectSource: forJob("J1") }),
      ),
    ).toBe(
      await buildInputId(
        input({ files: forJob("J2"), projectSource: forJob("J2") }),
      ),
    );
  });

  test("changes with the layers it is built against", async () => {
    const base = { ...target, base: { ...target.base, rev: "base-2" } };
    const layer = { ...target, project: { ...target.project, rev: "layer-2" } };
    expect(await buildInputId(input({ target: base }))).not.toBe(
      await buildInputId(input()),
    );
    expect(await buildInputId(input({ target: layer }))).not.toBe(
      await buildInputId(input()),
    );
  });

  test("does NOT change with the shell the loader runs it in", async () => {
    // Chosen by the loader when it serves, and no byte of the build depends on it.
    const shell = {
      ...target,
      base: { ...target.base, shellRev: "shell-2", rscShellRev: "rsc-shell-2" },
    };
    expect(await buildInputId(input({ target: shell }))).toBe(
      await buildInputId(input()),
    );
  });

  test("changes with env, public files, assets and options", async () => {
    const plain = await buildInputId(input());
    expect(await buildInputId(input({ env: { PUBLIC_A: "1" } }))).not.toBe(
      plain,
    );
    expect(
      await buildInputId(input({ publicFiles: { "logo.svg": "PHN2Zz4=" } })),
    ).not.toBe(plain);
    expect(
      await buildInputId(input({ assets: { "src/a.png": "iVBO" } })),
    ).not.toBe(plain);
    expect(
      await buildInputId(input({ dependencyAssets: { "font.woff2": "d09G" } })),
    ).not.toBe(plain);
    expect(await buildInputId(input({ rsc: true }))).not.toBe(plain);
    expect(
      await buildInputId(
        input({
          routeSplitter: {
            reference: () => null,
            virtual: (_id, code) => ({ code }),
          },
        }),
      ),
    ).not.toBe(plain);
  });

  test("changes with what a caller says it adds after the build", async () => {
    // The Studio may ship the live site's stylesheet in place of an empty one:
    // an input the build never saw, so the caller names it.
    const carrying = (sha: string) =>
      input({ extraInputs: { liveStylesheet: sha } });
    expect(await buildInputId(carrying("abc"))).not.toBe(
      await buildInputId(input()),
    );
    expect(await buildInputId(carrying("abc"))).not.toBe(
      await buildInputId(carrying("def")),
    );
  });
});
