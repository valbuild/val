import { startContentHost, type ContentHost } from "./world/contentHost";
import { createHttpSketchpadStore } from "../../packages/server/src/sketchpads/httpSketchpadStore";

/**
 * The mock content host keeps sketchpads as valbuild/home does, at
 * `/v1/{project}/sketchpads`, so the Studio's Sketchpad works against it in
 * proxy mode (the e2e apps, and the val.build showcase's Sketchpad clip).
 * Driven through the store `ValOpsHttp` uses, so the two cannot drift.
 */
describe("sketchpads on the mock content host", () => {
  let host: ContentHost;
  beforeAll(async () => {
    host = await startContentHost({});
  });
  afterAll(async () => {
    await host.stop();
  });

  const store = () =>
    createHttpSketchpadStore({
      url: `${host.url}/v1/${host.project}/sketchpads`,
      headers: { Authorization: `Bearer ${host.apiKey}` },
    });

  test("one is made, listed, read and changed, with the version checked", async () => {
    const sketchpads = store();
    const made = await sketchpads.create({
      text: "# A page\n",
      title: "A page",
      page: null,
      by: "profile-ada",
    });
    expect(made).toMatchObject({
      version: 1,
      archived: false,
      title: "A page",
    });

    expect(
      (await sketchpads.list({ archived: "exclude" })).map((s) => s.id),
    ).toEqual([made.id]);
    expect((await sketchpads.get(made.id))?.text).toBe("# A page\n");

    const updated = await sketchpads.update(made.id, {
      baseVersion: 1,
      text: "# A better page\n",
      by: "profile-ada",
    });
    expect(updated).toMatchObject({
      status: "updated",
      sketchpad: { version: 2, text: "# A better page\n" },
    });

    // A change made from the version before is refused, with how it is now.
    const stale = await sketchpads.update(made.id, {
      baseVersion: 1,
      text: "# Lost\n",
      by: "profile-linus",
    });
    expect(stale).toMatchObject({
      status: "conflict",
      sketchpad: { version: 2, text: "# A better page\n" },
    });
  });

  test("an archived one is left out unless asked for", async () => {
    const sketchpads = store();
    const made = await sketchpads.create({
      text: "# Old\n",
      title: "Old",
      page: "/old",
      by: null,
    });
    await sketchpads.update(made.id, {
      baseVersion: 1,
      archived: true,
      by: null,
    });
    const ids = async (archived: "exclude" | "only") =>
      (await sketchpads.list({ archived, page: "/old" })).map((s) => s.id);
    expect(await ids("exclude")).toEqual([]);
    expect(await ids("only")).toEqual([made.id]);
  });

  test("one that does not exist is not found", async () => {
    expect(
      await store().get("00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
  });
});
