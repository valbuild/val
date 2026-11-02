import { Internal, initVal, type SerializedSchema } from "@valbuild/core";
import {
  createWorld,
  moduleFilePathOf,
  type ServerMode,
  type World,
} from "./world/createWorld";
import { createPosterPatch } from "../../packages/ui/spa/utils/video/createVideoPatch";

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
 * Content shapes: `.jsonValues()` entries, uploads, galleries. Catalogue ids
 * S17, S18, S19.
 */

const { s, c, config } = initVal({});

const pagesVal = c.define(
  "/content/pages.val.ts",
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
    "/a": c.json(() => Promise.resolve({ default: { title: "Page A" } })),
    "/b": c.json(() => Promise.resolve({ default: { title: "Page B" } })),
  },
);

const videoVal = c.define(
  "/content/video.val.ts",
  s.object({ clip: s.video() }),
  {
    clip: {
      path: "/public/val/clip.mp4",
      mimeType: "video/mp4",
      width: 640,
      height: 360,
      duration: 10,
    },
  },
);

const IMAGE = "/public/val/images/a.png";
const imagesVal = c.define(
  "/content/images.val.ts",
  s.imagedir("/public/val/images", { alt: s.string() }),
  { [IMAGE]: { width: 10, height: 10, mimeType: "image/png", alt: "Old alt" } },
);
const heroVal = c.define(
  "/content/hero.val.ts",
  s.object({ hero: s.image(imagesVal) }),
  { hero: { path: IMAGE } },
);

describe.each<ServerMode>(["memory", "fs", "http"])("on %s", (server) => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
  });

  /**
   * S17 An edit inside an unloaded `.jsonValues()` entry.
   *
   * Given a record of entries, a draft page with the overlay reading it on
   * the server, and an editor who opens one entry's field,
   * when the editor edits that entry's title -- an entry the overlay's
   * Studio has never loaded,
   * then the editor's field and the page's loader show the edit, the overlay
   * hands the page the entry's content with the edit (not a marker, not the
   * committed content), and no edit is discarded.
   *
   * It was skipped, for two bugs both fixed: the page's server read of the
   * whole record filled entries from the bundle (F1), and the overlay's
   * Studio kept the edit it could not apply while the entry was unloaded and
   * relayed the committed entry once it loaded (F2).
   *
   * The page's HOOK reading a whole `.jsonValues()` record is not covered:
   * `useValStega` fills the entries through `React.use` on cached promises,
   * which is not yet a plain function the world can call.
   */
  test("S17 an edit inside an unloaded .jsonValues() entry", async () => {
    world = await createWorld({ config, modules: [pagesVal], server });
    const { editor, page } = await editUnloadedEntry(world);
    expect(world.frames.last("field")).toBe("Edited A");
    expect(world.frames.last("loader")).toBe("Edited A");
    expect(editor.errors()).toEqual([]);
    expect(page.studio.errors()).toEqual([]);
    expect(lastRelayedTitle(page.events)).toBe("Edited A");
    expect(world.network.log.filter((e) => e.method === "DELETE")).toEqual([]);
  });

  /**
   * S18 An upload's patch_id reaches the page where the file lands.
   *
   * Given a video field, and a draft page with the overlay showing its poster
   * through a hook and a loader,
   * when the editor uploads a new poster (`createPosterPatch`, what the video
   * field calls, written and uploaded the way a field writes it),
   * then both the hook and the loader name the poster with the upload's
   * `patch_id`, and the draft file can be fetched at that URL.
   *
   * Why it matters: where the file's `patch_id` lands (the video's path
   * plus `nestedFilePath`) is the engine's rule (`applyPatchRecord`), and
   * since phase 5 the Studio reads through it as the server does. Before, the
   * Studio stamped it in the relay (`withFilePatchIds`, keyed by the file's
   * path) -- a second implementation, which this held to the first.
   */
  test("S18 an upload's patch_id reaches the page where the file lands", async () => {
    world = await createWorld({ config, modules: [videoVal], server });
    const editor = await world.studio("editor");
    const page = await world.loadPage("/", {
      shows: [{ surface: "hook", module: videoVal, field: ["clip", "poster"] }],
      loaderShows: [
        { surface: "loader", module: videoVal, field: ["clip", "poster"] },
      ],
    });

    const bytes = new TextEncoder().encode("not really a png");
    const patchId = await editor.write(
      videoVal,
      createPosterPatch({
        patchPath: ["clip"],
        dir: "/public/val",
        videoPath: "/public/val/clip.mp4",
        poster: {
          bytes,
          dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
          mimeType: "image/png",
          sha256: Internal.getSHA256Hash(bytes),
          width: 2,
          height: 2,
        },
        posterTime: 1.5,
        remote: null,
        schema: videoSchema(),
      }),
      "image",
    );
    await world.settle();

    for (const surface of ["hook", "loader"]) {
      const poster = world.frames.last(surface);
      expect({ surface, patch_id: fieldOf(poster, "patch_id") }).toEqual({
        surface,
        patch_id: patchId,
      });
      const url = fieldOf(poster, "url");
      expect(typeof url).toBe("string");
      expect(String(url)).toContain(`patch_id=${patchId}`);
    }
    const url = String(fieldOf(world.frames.last("loader"), "url"));
    const response = await world.network.fetchFor("page:/")(url, {
      method: "GET",
    });
    expect(response.status).toBe(200);
    expect(page.studio.errors()).toEqual([]);
  });

  /**
   * S19 A gallery-backed field whose gallery changes.
   *
   * Given an image field that picks from a gallery, carrying only the path,
   * shown on a draft page with the overlay through a hook and a loader,
   * when the editor changes the gallery entry's alt text,
   * then the field still resolves, both readers show the gallery's new
   * alt (the field has none of its own), and the field's module keeps its
   * version: its schema names the gallery by path, so a change to the
   * gallery's content moves the gallery's chain and nothing of the field's.
   */
  test("S19 a gallery-backed field whose gallery changes", async () => {
    world = await createWorld({
      config,
      modules: [imagesVal, heroVal],
      server,
    });
    const editor = await world.studio("editor");
    await world.loadPage("/", {
      shows: [{ surface: "hook", module: heroVal, field: ["hero", "alt"] }],
      loaderShows: [
        { surface: "loader", module: heroVal, field: ["hero", "alt"] },
      ],
    });
    const before = await world.manifest();
    await editor.edit(imagesVal, [IMAGE, "alt"], "New alt");
    await world.settle();

    expect(world.frames.last("hook")).toBe("New alt");
    expect(world.frames.last("loader")).toBe("New alt");
    expect(editor.errors()).toEqual([]);
    const after = await world.manifest();
    const hero = moduleFilePathOf(heroVal);
    const images = moduleFilePathOf(imagesVal);
    expect(after.modules[hero]).toEqual(before.modules[hero]);
    expect(after.modules[images]?.schema).toBe(before.modules[images]?.schema);
    expect(after.modules[images]?.chain).not.toBe(
      before.modules[images]?.chain,
    );
    world.expectInvariants();
  });
});

/** S17's steps: the editor opens entry /a's field, the page loads, the editor edits it. */
async function editUnloadedEntry(world: World) {
  const editor = await world.studio("editor");
  editor.reads("field", pagesVal, ["/a", "title"]);
  const page = await world.loadPage("/", {
    shows: [],
    loaderShows: [
      { surface: "loader", module: pagesVal, field: ["/a", "title"] },
    ],
  });
  await world.observe(); // the editor's field reads the entry, which loads it
  await editor.edit(pagesVal, ["/a", "title"], "Edited A");
  await world.settle();
  await world.observe();
  return { editor, page };
}

/** The title of entry /a in the last module source the overlay relayed. */
function lastRelayedTitle(events: readonly { type: string }[]): unknown {
  const sent = events.filter(
    (
      e,
    ): e is {
      type: "source-update";
      moduleFilePath: string;
      source: unknown;
    } =>
      e.type === "source-update" &&
      "moduleFilePath" in e &&
      e.moduleFilePath === "/content/pages.val.ts",
  );
  const last = sent.at(-1);
  return last === undefined ? undefined : entryTitle(last.source, "/a");
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Object.entries(value).find(([k]) => k === key)?.[1]
    : undefined;
}

function entryTitle(source: unknown, key: string): unknown {
  return fieldOf(fieldOf(source, key), "title");
}

/** The video field's serialized schema, as the field component is handed it. */
function videoSchema(): Extract<SerializedSchema, { type: "video" }> {
  const root = Internal.getSchema(videoVal)?.["executeSerialize"]();
  const clip = root?.type === "object" ? root.items["clip"] : undefined;
  if (clip?.type !== "video") throw new Error("no video schema at clip");
  return clip;
}
