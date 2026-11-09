import {
  Internal,
  initVal,
  type Json,
  type ModuleFilePath,
  type PatchId,
  type SelectorSource,
  type ValModule,
  type ValModules,
} from "@valbuild/core";
import {
  valModulesEntryFile as sharedEntryFile,
  valModulesEntryPath,
  type BuildRegistry,
} from "@valbuild/shared/internal";
import { createSystem, type System } from "./createSystem";
import { createFakeManifest } from "./testManifest";
import {
  REGISTRY_IMPORT_DEADLINE_MS,
  STUDIO_RELOAD_GRACE_MS,
  registryEntryUrl,
} from "./buildCode";
import type { FetchManifest } from "./manifestSource";
import type { UploadFile } from "./PatchStore";

/**
 * A new build's code, into an open Studio (`BuildCode`, phase 9 of
 * `docs/plans/one-content-model.md`): what replaced the "A new version has
 * been deployed" dialog. The build's own registry is taken in before its
 * manifest; where it cannot be, the page reloads itself -- but never into
 * the same page, never under an edit on its way, and never in local
 * development, where HMR brings the code.
 */

const MODULE = "/home.val.ts" as ModuleFilePath;
const ENTRY = valModulesEntryPath("b2");

function before(): ValModule<SelectorSource> {
  const { c, s } = initVal();
  return c.define(MODULE, s.object({ title: s.string() }), { title: "Hi" });
}

function after(): ValModule<SelectorSource> {
  const { c, s } = initVal();
  return c.define(MODULE, s.object({ title: s.string(), cta: s.string() }), {
    title: "Hi",
    cta: "Buy",
  });
}

function registryOf(module: ValModule<SelectorSource>): ValModules {
  const { config } = initVal();
  return { config, modules: [{ def: async () => ({ default: module }) }] };
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await jest.advanceTimersByTimeAsync(0);
};

/**
 * A Studio on `before()`, against a server whose build the test moves: its
 * module, and the registry its manifest names (none: a deploy the platform
 * did not build).
 */
function setup(options: {
  mode: "fs" | "http";
  registry?: (build: "b1" | "b2") => BuildRegistry | undefined;
  imported?: () => ValModules | Promise<ValModules>;
  uploadFile?: UploadFile;
}) {
  let build: "b1" | "b2" = "b1";
  const builds = { b1: before(), b2: after() };
  const fake = createFakeManifest({
    bases: () =>
      new Map([
        [
          MODULE,
          {
            source: Internal.getSource(builds[build]) as Json,
            schema: Internal.getSchema(builds[build])!["executeSerialize"](),
          },
        ],
      ]),
    chain: () => [],
  });
  const fetchManifest: FetchManifest = async (held) => {
    const answer = await fake.fetchManifest(held);
    const registry = options.registry?.(build);
    if (answer.kind !== "manifest") return answer;
    return {
      ...answer,
      project: { ...answer.project, build },
      ...(registry !== undefined ? { registry } : {}),
    };
  };
  const imports: string[] = [];
  let reloads = 0;
  const system: System = createSystem({
    mode: options.mode,
    fetchManifest,
    fetchModule: fake.fetchModule,
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: () => "p" as PatchId,
    ...(options.uploadFile !== undefined
      ? {
          uploadFile: options.uploadFile,
          savePatches: async ({ patches, parentRef }) => ({
            status: "saved",
            newPatchIds: patches.map((patch) => patch.patchId),
            parentRef,
          }),
        }
      : {}),
    importRegistry: async (entry) => {
      imports.push(entry);
      return options.imported?.() ?? registryOf(builds.b2);
    },
    reloadStudio: () => {
      reloads++;
    },
  });
  system.host.receive([before()]);
  const stat = async () => {
    system.stat.receiveStat({ patches: [], baseSha: "base" });
    await settle();
    await system.manifest.settled();
    await settle();
  };
  return {
    system,
    stat,
    deploy: () => {
      build = "b2";
    },
    imports,
    reloads: () => reloads,
    schemaIs: (module: ValModule<SelectorSource>) =>
      JSON.stringify(system.schemaStore.get(MODULE)) ===
      JSON.stringify(Internal.getSchema(module)!["executeSerialize"]()),
  };
}

const ours: BuildRegistry = { entry: ENTRY, core: Internal.VERSION.core };

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

test("the build and the server name a build's registry by the same name", () => {
  // The builder does not export its name for it (not API): it pins this
  // literal in `valModules.test.ts`, and `@valbuild/shared` pins it too.
  expect(sharedEntryFile("b2")).toBe("val-modules-b2.js");
  expect(valModulesEntryPath("b2")).toBe("/_app/val-modules-b2.js");
});

test("a new build's registry is taken in before its manifest, and nothing reloads", async () => {
  const studio = setup({
    mode: "http",
    registry: (build) => (build === "b2" ? ours : undefined),
  });
  await studio.stat();
  expect(studio.schemaIs(before())).toBe(true);

  studio.deploy();
  await studio.stat();

  expect(studio.imports).toEqual([ENTRY]);
  expect(studio.schemaIs(after())).toBe(true);
  // The new field, read with the new schema, from the build's content.
  const cta = studio.system.sourceStore.peek(
    `${MODULE}?p="cta"` as Parameters<System["sourceStore"]["peek"]>[0],
  );
  expect(cta).toMatchObject({ status: "ready", data: "Buy" });
  await jest.advanceTimersByTimeAsync(STUDIO_RELOAD_GRACE_MS * 2);
  expect(studio.reloads()).toBe(0);

  // Once per build: the next manifest of the same build imports nothing.
  await studio.stat();
  expect(studio.imports).toHaveLength(1);
});

test("a build with another Val is not imported: the page reloads, after the grace", async () => {
  const studio = setup({
    mode: "http",
    registry: (build) =>
      build === "b2" ? { entry: ENTRY, core: "0.0.0-another" } : undefined,
  });
  await studio.stat();
  studio.deploy();
  await studio.stat();

  expect(studio.imports).toEqual([]);
  expect(studio.reloads()).toBe(0);
  await jest.advanceTimersByTimeAsync(STUDIO_RELOAD_GRACE_MS);
  expect(studio.reloads()).toBe(1);
});

test("a deploy that names no registry reloads the page once the two have agreed", async () => {
  const studio = setup({ mode: "http" });
  await studio.stat();
  studio.deploy();
  await studio.stat();
  await jest.advanceTimersByTimeAsync(STUDIO_RELOAD_GRACE_MS);
  expect(studio.reloads()).toBe(1);
});

test("a page that never agreed with the server is not reloaded into the same page", async () => {
  const studio = setup({ mode: "http" });
  studio.deploy();
  await studio.stat();
  await jest.advanceTimersByTimeAsync(STUDIO_RELOAD_GRACE_MS * 2);
  expect(studio.reloads()).toBe(0);
});

test("in local development nothing is imported or reloaded: HMR brings the code", async () => {
  const studio = setup({ mode: "fs", registry: () => ours });
  await studio.stat();
  studio.deploy();
  await studio.stat();
  await jest.advanceTimersByTimeAsync(STUDIO_RELOAD_GRACE_MS * 2);
  expect(studio.imports).toEqual([]);
  expect(studio.reloads()).toBe(0);
});

test("code that arrives within the grace (HMR) reloads nothing", async () => {
  const studio = setup({ mode: "http" });
  await studio.stat();
  studio.deploy();
  await studio.stat();
  await studio.system.host.reloadCode(registryOf(after()));
  await jest.advanceTimersByTimeAsync(STUDIO_RELOAD_GRACE_MS * 2);
  expect(studio.reloads()).toBe(0);
  expect(studio.schemaIs(after())).toBe(true);
});

test("a registry that is not the manifest's is not taken in", async () => {
  const { c, s } = initVal();
  const other = c.define(MODULE, s.object({ heading: s.string() }), {
    heading: "x",
  });
  const studio = setup({
    mode: "http",
    registry: (build) => (build === "b2" ? ours : undefined),
    imported: () => registryOf(other),
  });
  await studio.stat();
  studio.deploy();
  await studio.stat();
  expect(studio.imports).toEqual([ENTRY]);
  expect(studio.schemaIs(before())).toBe(true);
  await jest.advanceTimersByTimeAsync(STUDIO_RELOAD_GRACE_MS * 2);
  expect(studio.reloads()).toBe(0);
});

test("a registry that does not load falls back to reloading the page", async () => {
  const studio = setup({
    mode: "http",
    registry: (build) => (build === "b2" ? ours : undefined),
    imported: () => {
      throw new Error("404");
    },
  });
  await studio.stat();
  studio.deploy();
  await studio.stat();
  expect(studio.schemaIs(before())).toBe(true);
  await jest.advanceTimersByTimeAsync(STUDIO_RELOAD_GRACE_MS);
  expect(studio.reloads()).toBe(1);
});

test("an image on its way holds the reload until it has landed", async () => {
  let landed: () => void = () => {};
  const studio = setup({
    mode: "http",
    uploadFile: (request) =>
      request.data === null
        ? Promise.resolve({ status: "ok" })
        : new Promise((resolve) => {
            landed = () => resolve({ status: "ok" });
          }),
  });
  await studio.stat();
  // The bytes go up before the patch exists: nothing is pending meanwhile.
  const creating = studio.system.patchStore.createPatch(MODULE, [
    { op: "add", path: ["image"], value: { path: "/public/val/a.png" } },
    {
      op: "file",
      path: ["image"],
      filePath: "/public/val/a.png",
      value: "data:image/png;base64,AAAA",
      remote: false,
    },
  ]);
  await settle();
  expect(studio.system.patchStore.uploadsInFlight()).toBe(1);

  studio.deploy();
  await studio.stat();
  await jest.advanceTimersByTimeAsync(STUDIO_RELOAD_GRACE_MS * 2);
  expect(studio.reloads()).toBe(0);

  landed();
  await creating;
  await settle();
  await jest.advanceTimersByTimeAsync(0);
  expect(studio.system.patchStore.uploadsInFlight()).toBe(0);
  expect(studio.reloads()).toBe(1);
});

test("a registry that never finishes importing does not hold the manifest up, and the page reloads", async () => {
  const studio = setup({
    mode: "http",
    registry: (build) => (build === "b2" ? ours : undefined),
    imported: () => new Promise<ValModules>(() => {}),
  });
  await studio.stat();
  studio.deploy();
  studio.system.stat.receiveStat({ patches: [], baseSha: "base" });
  let adopted = false;
  void studio.system.manifest.settled().then(() => {
    adopted = true;
  });
  await jest.advanceTimersByTimeAsync(REGISTRY_IMPORT_DEADLINE_MS);
  await settle();
  // The manifest went on without the code, as for a registry that failed.
  expect(adopted).toBe(true);
  expect(studio.reloads()).toBe(0);
  await jest.advanceTimersByTimeAsync(STUDIO_RELOAD_GRACE_MS);
  expect(studio.reloads()).toBe(1);
});

test("a build's registry is imported only from the site's own origin", () => {
  const page = "https://site.example/val/content";
  expect(registryEntryUrl("/_app/val-modules-b2.js", page)).toBe(
    "https://site.example/_app/val-modules-b2.js",
  );
  expect(
    registryEntryUrl("https://site.example/_app/val-modules-b2.js", page),
  ).toBe("https://site.example/_app/val-modules-b2.js");
  for (const elsewhere of [
    "https://evil.example/_app/val-modules-b2.js",
    "//evil.example/_app/val-modules-b2.js",
    "http://site.example/_app/val-modules-b2.js",
    "data:text/javascript,export default 1",
    "javascript:alert(1)",
    "blob:https://site.example/1234",
  ]) {
    expect(registryEntryUrl(elsewhere, page)).toBe(null);
  }
});
