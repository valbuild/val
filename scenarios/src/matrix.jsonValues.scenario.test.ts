import { Internal, initVal, type SerializedSchema } from "@valbuild/core";
import { emptyOf } from "@valbuild/shared/internal";
import {
  recordAddPatch,
  recordRemovePatch,
} from "../../packages/ui/spa/components/recordPatches";
import { renameRecordEntry } from "../../packages/ui/spa/components/useRenameRecordEntry";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fieldOf,
  keysOf,
  matrix,
  type Cell,
  type CellContext,
  type Surface,
} from "./matrix/harness";

// See `smoke.scenario.test.ts` and the README for these two.
jest.mock(
  "@tanstack/react-start/server",
  () => jest.requireActual("./world/tanstackStart"),
  { virtual: true },
);
jest.mock("../../packages/ui/spa/validation/schemaValidationBridge", () =>
  jest.requireActual("./world/noWorkerBridge"),
);

/**
 * The matrix for a `.jsonValues()` record: every entry in a `*.val.json` of
 * its own, loaded on demand. A ROUTER, so the route readers (`fetchValRoute`,
 * `useValRoute`) read the same entries as the record readers (`fetchVal`,
 * `fetchValKey`, `useVal`, `useValKey`).
 */

const { s, c, config } = initVal({});
const BLOG = "/src/routes/_site.blog.$slug.val.ts";
const item = s.object({ title: s.string() });
const blogVal = c.define(
  BLOG,
  s.router(Internal.tanstackRouter, item).jsonValues(),
  {
    "/blog/a": c.json(() => Promise.resolve({ default: { title: "Page A" } })),
    "/blog/b": c.json(() => Promise.resolve({ default: { title: "Page B" } })),
  },
);
/** The module and its entries as files, for a publish to rewrite. */
const sourceText = {
  [BLOG]: `import { c, s, tanstackRouter } from "../../val.config";

export default c.define(
  "${BLOG}",
  s.router(tanstackRouter, s.object({ title: s.string() })).jsonValues(),
  {
    "/blog/a": c.json(() => import("./blog/a.val.json")),
    "/blog/b": c.json(() => import("./blog/b.val.json")),
  },
);
`,
  "/src/routes/blog/a.val.json": `{ "title": "Page A" }\n`,
  "/src/routes/blog/b.val.json": `{ "title": "Page B" }\n`,
};

/** The same record, with a field added to its item: a code change. */
const blogWithSummaryVal = c.define(
  BLOG,
  s
    .router(
      Internal.tanstackRouter,
      s.object({ title: s.string(), summary: s.string().nullable() }),
    )
    .jsonValues(),
  {
    "/blog/a": c.json(() =>
      Promise.resolve({ default: { title: "Page A", summary: null } }),
    ),
    "/blog/b": c.json(() =>
      Promise.resolve({ default: { title: "Page B", summary: null } }),
    ),
  },
);

/** Every reader of one entry's title, by the entry's route key. */
function titleSurfaces(key: string): Surface[] {
  const slug = key.slice("/blog/".length);
  return [
    {
      kind: "studio",
      name: `studio ${key}`,
      module: blogVal,
      field: [key, "title"],
    },
    {
      kind: "server",
      name: `fetchVal ${key}`,
      read: async (val) => fieldOf(await val.fetchVal(blogVal), [key, "title"]),
    },
    {
      kind: "server",
      name: `fetchValKey ${key}`,
      read: async (val) =>
        fieldOf(await val.fetchValKey(blogVal, key), ["title"]),
    },
    {
      kind: "server",
      name: `fetchValRoute ${key}`,
      read: async (val) =>
        fieldOf(await val.fetchValRoute(blogVal, { slug }), ["title"]),
    },
    {
      kind: "hook",
      name: `useVal ${key}`,
      module: blogVal,
      field: [key, "title"],
    },
    {
      kind: "hook",
      name: `useValKey ${key}`,
      module: blogVal,
      field: ["title"],
      via: { useValKey: key },
    },
    {
      kind: "hook",
      name: `useValRoute ${key}`,
      module: blogVal,
      field: ["title"],
      via: { useValRoute: { slug } },
    },
  ];
}

/** The record's keys, as the server's and the page's readers give them. */
const keySurfaces: Surface[] = [
  {
    kind: "server",
    name: "fetchVal keys",
    read: async (val) => keysOf(await val.fetchVal(blogVal)),
  },
  { kind: "hook", name: "useVal keys", module: blogVal, field: [] },
];

/** Each surface of `surfaces` expected to show `value`. */
function all(surfaces: Surface[], value: unknown): Record<string, unknown> {
  return Object.fromEntries(surfaces.map((surface) => [surface.name, value]));
}

/** The hook's whole value is a record: compare its keys. */
function keysExpected(keys: string[]): Record<string, unknown> {
  return {
    "fetchVal keys": keys,
    "useVal keys": expect.objectContaining(
      Object.fromEntries(keys.map((k) => [k, expect.anything()])),
    ),
  };
}

const itemSchema = (): SerializedSchema => {
  const root = Internal.getSchema(blogVal)?.["executeSerialize"]();
  if (root?.type !== "record") throw new Error("not a record");
  return root.item;
};

/** What the rename toolbar does, with the Studio's own write. */
async function rename(ctx: CellContext, fromKey: string, toKey: string) {
  const writes: Promise<unknown>[] = [];
  const res = await renameRecordEntry(
    {
      system: ctx.editor.system,
      addModuleFilePatch: (moduleFilePath, patch) => {
        writes.push(ctx.editor.writeAt(moduleFilePath, patch));
      },
      reportError: (title, message) => {
        throw new Error(`${title}: ${message}`);
      },
    },
    { parentPath: sourcePathOf(), fromKey, toKey, refs: [], jsonValues: true },
  );
  await Promise.all(writes);
  if (res.status !== "renamed") throw new Error("the rename was refused");
}

function sourcePathOf() {
  const path = Internal.getValPath(blogVal);
  if (path === undefined) throw new Error("no path");
  return path;
}

/**
 * Why cells fail today. Each is a bug: the user expects every one of these to
 * work. Evidence and suspected cause are in the README's matrix section.
 */
const F2 =
  "F2: a Studio that had not loaded the entry keeps the patch it could not apply and never applies it once the entry loads, so it shows (and the overlay relays) the committed entry";
const R1 =
  "R1: in memory mode, after a publish the page's readers keep the pre-publish content: initValContent's own server instance does not adopt the publish, only the API's instance that handled /save does (fs mode is right after the dev server reloads the rewritten files)";

/** The page's hooks for one entry, all failing for `reason`. */
function hooksFail(key: string, reason: string): Record<string, string> {
  return {
    [`useVal ${key}`]: reason,
    [`useValKey ${key}`]: reason,
    [`useValRoute ${key}`]: reason,
  };
}

const A = titleSurfaces("/blog/a");
const B = titleSurfaces("/blog/b");
const C = titleSurfaces("/blog/c");
const Z = titleSurfaces("/blog/z");

const cells: Cell[] = [
  {
    operation: "edit an entry",
    failing: hooksFail("/blog/a", F2),
    surfaces: A,
    run: async (ctx) => {
      await ctx.editor.edit(blogVal, ["/blog/a", "title"], "Edited A");
    },
    expected: () => all(A, "Edited A"),
  },
  {
    operation: "add an entry",
    surfaces: [...C, ...keySurfaces],
    run: async (ctx) => {
      await ctx.editor.write(
        blogVal,
        recordAddPatch([], "/blog/c", emptyOf(itemSchema())),
      );
      await ctx.world.settle();
      await ctx.editor.edit(blogVal, ["/blog/c", "title"], "Page C");
    },
    expected: () => ({
      ...all(C, "Page C"),
      ...keysExpected(["/blog/a", "/blog/b", "/blog/c"]),
    }),
  },
  {
    operation: "rename a key",
    failing: hooksFail("/blog/z", F2),
    surfaces: [...Z, ...keySurfaces],
    run: async (ctx) => {
      await rename(ctx, "/blog/a", "/blog/z");
    },
    expected: () => ({
      ...all(Z, "Page A"),
      ...keysExpected(["/blog/b", "/blog/z"]),
    }),
  },
  {
    operation: "delete an entry",
    surfaces: [...B, ...keySurfaces],
    run: async (ctx) => {
      await ctx.editor.write(blogVal, recordRemovePatch(["/blog/b"]));
    },
    expected: () => ({
      "studio /blog/b": "(absent)",
      "fetchVal /blog/b": undefined,
      "fetchValKey /blog/b": undefined,
      "fetchValRoute /blog/b": undefined,
      "useVal /blog/b": undefined,
      "useValKey /blog/b": undefined,
      "useValRoute /blog/b": undefined,
      ...keysExpected(["/blog/a"]),
    }),
  },
  {
    operation: "discard an edit",
    surfaces: A,
    neverGoesBack: false,
    run: async (ctx) => {
      const patchId = await ctx.editor.edit(
        blogVal,
        ["/blog/a", "title"],
        "Edited A",
      );
      await ctx.world.settle();
      await ctx.editor.discard([patchId]);
    },
    expected: () => all(A, "Page A"),
  },
  {
    operation: "publish an edit",
    failingIn: {
      memory: {
        "fetchVal /blog/a": R1,
        "fetchValKey /blog/a": R1,
        "fetchValRoute /blog/a": R1,
        ...hooksFail("/blog/a", R1),
      },
    },
    surfaces: [
      ...A,
      {
        kind: "after",
        name: "entry file on disk",
        read: async (ctx) =>
          ctx.world.server.mode === "fs"
            ? JSON.parse(
                readFileSync(
                  join(ctx.world.server.root, "src/routes/blog/a.val.json"),
                  "utf8",
                ),
              )
            : "(memory: no disk)",
      },
    ],
    run: async (ctx) => {
      await ctx.editor.edit(blogVal, ["/blog/a", "title"], "Edited A");
      await ctx.world.settle();
      const published = await ctx.editor.publish();
      ctx.kept["publish"] = published.status;
    },
    expected: (ctx) => ({
      ...all(A, "Edited A"),
      "entry file on disk":
        ctx.world.server.mode === "fs"
          ? { title: "Edited A" }
          : "(memory: no disk)",
    }),
  },
  {
    operation: "another editor's edit, via /stat",
    failing: hooksFail("/blog/a", F2),
    surfaces: A,
    run: async (ctx) => {
      const other = await ctx.other();
      await other.edit(blogVal, ["/blog/a", "title"], "Edited by other");
    },
    expected: () => all(A, "Edited by other"),
  },
  {
    operation: "a code change to the item schema",
    surfaces: A,
    run: async (ctx) => {
      await ctx.world.changeCode([blogWithSummaryVal]);
    },
    expected: () => all(A, "Page A"),
  },
  {
    operation: "an edit to an entry nobody has loaded",
    failing: {
      ...hooksFail("/blog/a", F2),
      "studio /blog/a, opened after": F2,
    },
    // Written without the entry open anywhere -- as the assistant's
    // `create_patch` writes -- so no Studio and no page has loaded it. The
    // editor's own field is read last, which loads it there.
    surfaces: [
      ...A.filter((surface) => surface.kind !== "studio"),
      {
        kind: "after",
        name: "studio /blog/a, opened after",
        read: async (ctx) => {
          const path = Internal.createValPathOfItem(
            Internal.createValPathOfItem(sourcePathOf(), "/blog/a"),
            "title",
          );
          if (path === undefined) throw new Error("no path");
          const read = await ctx.editor.system.sourceStore.get(path, null);
          return "data" in read ? read.data : `(${read.status})`;
        },
      },
    ],
    run: async (ctx) => {
      await ctx.editor.edit(blogVal, ["/blog/a", "title"], "Edited A");
    },
    expected: () => ({
      ...all(A, "Edited A"),
      "studio /blog/a, opened after": "Edited A",
    }),
  },
];

matrix({ name: "jsonValues", config, modules: [blogVal], sourceText }, cells);
