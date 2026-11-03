import type { ModuleFilePath } from "@valbuild/core";
import {
  FEATURED,
  IMAGES,
  POSTS,
  RECORD_WINDOW_ROWS,
  discardAll,
  inspectLibraryEntry,
  keyOfDropdown,
  keystroke,
  openEntry,
  openPicker,
  openRecord,
  pick,
  postKey,
  scaleConfig,
  scaleProject,
  scaleSizesFrom,
  search,
  validateAll,
  type MediaRefs,
  type ScaleProject,
} from "../measure/scaleWork";
import { createWorld, type Studio, type World } from "./world/createWorld";

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
 * Phase 10: the Studio at size, COUNTED. A report, not a gate: each surface
 * of the Studio is driven through the store calls its component makes
 * (`measure/scaleWork.ts`), on a project of N posts in a `.jsonValues()`
 * router and N files in each of three libraries, and what it did is printed
 * as a table -- requests and bytes, entries imported, versions hashed, bytes
 * the engine copied, previews computed.
 *
 * Only what cannot regress without a bug is a gate (`expect`), and a gate
 * that fails today is `test.failing` with the number it found.
 *
 * The default run is 1,000 posts, local and remote. More:
 *
 *   VAL_SCALE=1000,10000,100000 pnpm test scenarios/src/scale
 *   VAL_SCALE=10000 VAL_SCALE_MEDIA=remote pnpm test scenarios/src/scale
 *
 * The times and the heap of the same surfaces are `measure/scale.ts`'s.
 */

const SIZES = scaleSizesFrom(process.env.VAL_SCALE, [1_000]);
const MEDIA: MediaRefs[] = (process.env.VAL_SCALE_MEDIA ?? "local,remote")
  .split(",")
  .map((part) => part.trim())
  .filter((part): part is MediaRefs => part === "local" || part === "remote");

/**
 * Above this many posts the surfaces that load EVERY post (the gallery's
 * "used by", search) are left out. Unlimited by default since phase 10's fix
 * made that load linear (a request per batch of keys, the view rebuilt per
 * batch); `VAL_SCALE_LOAD_ALL_MAX=10000` skips them at 100,000.
 */
const LOAD_ALL_MAX = Number(
  process.env.VAL_SCALE_LOAD_ALL_MAX ?? Number.POSITIVE_INFINITY,
);

/**
 * The most keys a bulk `GET /json` is held to by the URL budget alone, at
 * this project's key length (`/blog/post-12345`): fewer than this per
 * request would mean the batches are not filling.
 */
const MIN_KEYS_PER_BULK_REQUEST = 25;

/** Large worlds take a while to build: seconds per 10,000 entries. */
jest.setTimeout(Math.max(...SIZES) >= 100_000 ? 1_800_000 : 300_000);

type Row = {
  surface: string;
  entries: number;
  media: MediaRefs;
  requests: string;
  kb: number;
  imports: number;
  studio: Record<string, number>;
  server: Record<string, number>;
  note?: string;
};
const report: Row[] = [];

afterAll(() => {
  if (report.length === 0) return;
  const lines = [
    "",
    "| surface | entries | media | requests | KB | entry imports | Studio work | server work | note |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.map(
      (row) =>
        `| ${row.surface} | ${row.entries} | ${row.media} | ${row.requests || "-"} | ${row.kb} | ${row.imports} | ${fmt(row.studio)} | ${fmt(row.server)} | ${row.note ?? ""} |`,
    ),
    "",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
});

function fmt(work: Record<string, number>): string {
  const parts = Object.entries(work)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${kind} ${n}`);
  return parts.length === 0 ? "-" : parts.join(", ");
}

/** The Studio's kinds worth printing; an amount is summed, the rest counted. */
const STUDIO_KINDS = [
  "source:clone-module",
  "source:apply-patch",
  "engine:clone-bytes",
  "version:hash",
  "source:load-json-entry",
  "source:fetch-json-entries",
  "source:receive-json-entry",
  "source:apply-json-entries",
  "source:rebuild-module",
  "host:execute-preview",
  "preview:cache-miss",
  "host:execute-validate",
  "validation:schema-validate",
  "search:index-module",
  "references:scan-module",
  "patch:save",
  "source:wake-listener",
] as const;
const SUMMED = new Set(["engine:clone-bytes", "version:hash"]);

type Mark = {
  log: number;
  imports: number;
  studio: number;
  server: ReturnType<World["workPosition"]>;
};

function mark(world: World, studio: Studio, project: ScaleProject): Mark {
  return {
    log: world.network.log.length,
    imports: project.imports.count,
    studio: studio.work.position(),
    server: world.workPosition(),
  };
}

/** What happened since `since`, as one row of the report. */
function measured(
  world: World,
  studio: Studio,
  project: ScaleProject,
  since: Mark,
  surface: string,
  note?: string,
): Row & { byRequest: Record<string, number> } {
  const exchanges = world.network.log.slice(since.log);
  const byRequest: Record<string, number> = {};
  let bytes = 0;
  for (const exchange of exchanges) {
    const name = `${exchange.method} ${exchange.path.replace("/api/val", "")}`;
    byRequest[name] = (byRequest[name] ?? 0) + 1;
    bytes += exchange.bytes ?? 0;
  }
  const studioWork: Record<string, number> = {};
  for (const kind of STUDIO_KINDS) {
    studioWork[kind] = SUMMED.has(kind)
      ? studio.work.total(kind, { since: since.studio })
      : studio.work.count(kind, { since: since.studio });
  }
  const server = world.workPosition();
  const row = {
    surface,
    entries: project.entries,
    media: project.media,
    requests: Object.entries(byRequest)
      .map(([name, n]) => `${n}× ${name}`)
      .join(", "),
    kb: Math.round(bytes / 102.4) / 10,
    imports: project.imports.count - since.imports,
    studio: studioWork,
    server: {
      "version:hash": server.versionHashes - since.server.versionHashes,
      "engine:apply-patch": server.engineApplies - since.server.engineApplies,
      "engine:clone-bytes":
        server.engineCloneBytes - since.server.engineCloneBytes,
    },
    ...(note !== undefined ? { note } : {}),
  };
  report.push(row);
  return { ...row, byRequest };
}

/** How many rows the module's preview names: the `keyOf` dropdown's options. */
function previewRows(studio: Studio, module: ModuleFilePath): number {
  const read = studio.system.previewStore.peek(
    module as unknown as Parameters<typeof studio.system.previewStore.peek>[0],
  );
  return read.status === "previewed" && read.preview.status === "success"
    ? (read.preview.data.rows?.items.length ?? 0)
    : -1;
}

function hits(found: Awaited<ReturnType<Studio["system"]["search"]>>): string {
  if (found.status !== "results") return found.status;
  return `${found.total} hit(s)${found.partialModules.length > 0 ? `, ${found.partialModules.length} module(s) partial` : ""}`;
}

/**
 * Gate: loading every post is linear. Requests carry many keys (entries /
 * batch, not one per entry), and the record's view is rebuilt per batch that
 * landed, never per entry -- the two things that made it quadratic (44 s at
 * 10,000 in the baseline).
 */
function expectBatched(row: ReturnType<typeof measured>, n: number): void {
  const requests = row.byRequest["GET /json"] ?? 0;
  expect(requests).toBeGreaterThan(0);
  expect(requests).toBeLessThanOrEqual(
    Math.ceil(n / MIN_KEYS_PER_BULK_REQUEST),
  );
  expect(row.studio["source:fetch-json-entries"]).toBe(requests);
  const applies = row.studio["source:apply-json-entries"];
  expect(applies).toBeGreaterThan(0);
  expect(applies).toBeLessThanOrEqual(requests);
}

describe.each(MEDIA)("%s media", (media) => {
  describe.each(SIZES)("%d entries", (n) => {
    let world: World | null = null;
    afterEach(async () => {
      await world?.dispose();
      world = null;
    });

    test("every surface of the Studio, counted", async () => {
      const project = scaleProject({ entries: n, media });
      const target = postKey(1);
      world = await createWorld({
        config: scaleConfig,
        modules: project.modules,
        server: "memory",
        sourceText: project.sourceText([target]),
      });
      const w = world;

      // Cold start: `ValStoreProvider` taking the modules in, then /stat.
      const coldLog = w.network.log.length;
      const coldImports = project.imports.count;
      const coldServer = w.workPosition();
      const editor = await w.studio("editor");
      await w.settle();
      const cold = measured(
        w,
        editor,
        project,
        { log: coldLog, imports: coldImports, studio: 0, server: coldServer },
        "cold start",
      );
      expect(editor.errors()).toEqual([]);
      // Gate: starting the Studio loads no post. It holds a marker per entry.
      expect(cold.byRequest["GET /json"] ?? 0).toBe(0);
      expect(cold.studio["source:load-json-entry"]).toBe(0);

      // Opening the record: the list, its preview, its first window.
      let since = mark(w, editor, project);
      const record = await openRecord(editor.system, POSTS, project.postKeys);
      await w.settle();
      const rowsPreviewed = previewRows(editor, POSTS);
      const opened = measured(
        w,
        editor,
        project,
        since,
        "open the record",
        `${record.window.length} rows on screen; preview has ${rowsPreviewed} rows`,
      );
      // Gate: only the rows on screen are fetched, and in ONE request: the
      // rows' reads of one render pass are one batch.
      expect(opened.studio["source:load-json-entry"]).toBeLessThanOrEqual(
        RECORD_WINDOW_ROWS,
      );
      expect(opened.byRequest["GET /json"] ?? 0).toBe(1);
      expect(opened.studio["source:apply-json-entries"]).toBe(1);

      // Opening one post, and typing into its title.
      const key = postKey(0);
      since = mark(w, editor, project);
      const unmountEntry = await openEntry(editor.system, POSTS, key, [
        "title",
        "slug",
        "image",
      ]);
      await w.settle();
      measured(w, editor, project, since, "open one post");
      since = mark(w, editor, project);
      await keystroke(editor.system, POSTS, [key, "title"], "Typed");
      measured(w, editor, project, since, "keystroke (Studio)");
      since = mark(w, editor, project);
      await w.settle();
      measured(w, editor, project, since, "keystroke (saved, /stat)");

      // The image library's picker, and picking its last image for the page.
      since = mark(w, editor, project);
      const picker = await openPicker(editor.system, IMAGES);
      await w.settle();
      measured(
        w,
        editor,
        project,
        since,
        "open the image picker",
        `${picker.rows} rows`,
      );
      since = mark(w, editor, project);
      const unmountPick = await pick(
        editor.system,
        FEATURED,
        ["hero"],
        IMAGES,
        project.imagePaths[n - 1],
      );
      await w.settle();
      measured(w, editor, project, since, "pick from the library");

      // The page's `keyOf` dropdown, naming every post.
      since = mark(w, editor, project);
      const unmountKeyOf = await keyOfDropdown(editor.system, POSTS);
      await w.settle();
      measured(
        w,
        editor,
        project,
        since,
        "keyOf dropdown",
        `preview names ${previewRows(editor, POSTS)} of ${n} posts`,
      );

      // Validation of everything loaded.
      since = mark(w, editor, project);
      await validateAll(editor.system);
      await w.settle();
      measured(w, editor, project, since, "validate everything");

      // Discard all (the keystroke and the pick).
      since = mark(w, editor, project);
      const discarded = await discardAll(editor.system);
      await w.settle();
      measured(
        w,
        editor,
        project,
        since,
        "discard all",
        `answered ${discarded.status}`,
      );

      // Publish one post's edit.
      const unmountTarget = await openEntry(editor.system, POSTS, target, [
        "title",
      ]);
      const edit = await keystroke(
        editor.system,
        POSTS,
        [target, "title"],
        "Published",
      );
      await w.settle();
      since = mark(w, editor, project);
      const published = await editor.publish([edit]);
      await w.settle();
      measured(
        w,
        editor,
        project,
        since,
        "publish one post",
        `answered ${published.status}`,
      );

      if (n > LOAD_ALL_MAX) {
        report.push({
          surface: "select an image in the gallery; search",
          entries: n,
          media,
          requests: "",
          kb: 0,
          imports: 0,
          studio: {},
          server: {},
          note: `not run: VAL_SCALE_LOAD_ALL_MAX is ${LOAD_ALL_MAX}`,
        });
      } else {
        // Selecting an image in the library's gallery: its "used by" list.
        since = mark(w, editor, project);
        const inspected = await inspectLibraryEntry(
          editor.system,
          IMAGES,
          project.imagePaths[n - 1],
        );
        await w.settle();
        const selected = measured(
          w,
          editor,
          project,
          since,
          "select an image in the gallery",
          `used by ${inspected.referrers}; loaded every entry of ${inspected.loaded.length} module(s)`,
        );
        expectBatched(selected, n);

        // Search, from a Studio of its own: the editor's has every post now.
        const searcher = await w.studio("searcher");
        await w.settle();
        since = mark(w, searcher, project);
        const found = await search(searcher.system, `Post number ${n - 1}`);
        await w.settle();
        const searched = measured(
          w,
          searcher,
          project,
          since,
          "search (one query)",
          `first answer ${hits(found.first)}, after loading ${hits(found.last)}`,
        );
        expectBatched(searched, n);
        since = mark(w, searcher, project);
        await validateAll(searcher.system);
        await w.settle();
        measured(
          w,
          searcher,
          project,
          since,
          "validate everything (every post loaded)",
        );
      }

      unmountTarget();
      unmountEntry();
      unmountPick();
      unmountKeyOf();
      picker.unmount();
      record.unmount();
      expect(editor.errors()).toEqual([]);
    });
  });
});
