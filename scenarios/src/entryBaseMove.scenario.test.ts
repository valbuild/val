import { Internal, initVal, type SourcePath } from "@valbuild/core";
import { createWorld, type ServerMode, type World } from "./world/createWorld";

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
 * S29 A `.jsonValues()` entry read while its base moves.
 *
 * An entry is read on a base: `GET /json` answers with the server's content
 * for it. When another editor publishes into that entry while one Studio's
 * read of it is on its way back, the answer is the entry from BEFORE the
 * publish, and the Studio has moved to the published base by the time it
 * lands. Applied, it was the published base's entry for good -- nothing asks
 * for an entry that is already here -- and the field showed the old title
 * until a reload. Stamped with the base it was asked on, it is asked for
 * again (`SourceStore.entryBases`).
 */

const { s, c, config } = initVal({});
const BLOG = "/src/routes/_site.blog.$slug.val.ts";
const blogVal = c.define(
  BLOG,
  s
    .router(Internal.tanstackRouter, s.object({ title: s.string() }))
    .jsonValues(),
  {
    "/blog/a": c.json(() => Promise.resolve({ default: { title: "Page A" } })),
    "/blog/b": c.json(() => Promise.resolve({ default: { title: "Page B" } })),
  },
);

/** The module and its entries as files, for the publish to rewrite. */
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

describe.each<ServerMode>(["memory", "fs", "http"])("on %s", (server) => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
  });

  test("S29 an entry answered before a publish is read again after it", async () => {
    world = await createWorld({
      config,
      modules: [blogVal],
      server,
      sourceText,
    });
    const publisher = await world.studio("publisher");
    await world.settle();

    // The reader's entry reads: answered at once, on the base before the
    // publish, and held on their way back.
    world.network.hold({
      path: "/api/val/json",
      from: "studio:reader",
      at: "answer",
    });
    const reader = await world.studio("reader");
    reader.reads("field", blogVal, ["/blog/a", "title"]);
    const path = `${BLOG}?p="/blog/a"."title"` as SourcePath;
    const read = reader.system.sourceStore.get(path, null);
    await world.settle();
    expect(
      world.network.log.filter(
        (e) => e.path === "/api/val/json" && e.status === "held",
      ),
    ).toHaveLength(1);

    await publisher.write(blogVal, [
      { op: "replace", path: ["/blog/a", "title"], value: "Published A" },
    ]);
    await world.settle();
    expect((await publisher.publish()).status).toBe("published");
    await world.settle();

    world.network.release();
    expect(await read).toMatchObject({ data: "Published A" });
    await world.settle();
    await world.observe();

    expect(world.frames.last("field")).toBe("Published A");
    expect(reader.errors()).toEqual([]);
  }, 30_000);
});
