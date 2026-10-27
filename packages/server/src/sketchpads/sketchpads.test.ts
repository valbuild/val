import fs from "fs";
import os from "os";
import path from "path";
import { createFsSketchpadStore } from "./fsSketchpadStore";
import { createHttpSketchpadStore } from "./httpSketchpadStore";
import { createSketchpadRoutes } from "./sketchpadRoutes";
import {
  createMemorySketchpadStore,
  newSketchpadId,
  type SketchpadStore,
} from "./SketchpadStore";

const SKETCH = "# Our people\n[hero: The team](image: /public/val/team.jpg)\n";
const OTHER = "# Our people\nWe are 40 people in Oslo.\n";

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 27, 12, 0, clock++));

describe.each<[string, () => SketchpadStore]>([
  ["memory", () => createMemorySketchpadStore(now)],
  [
    "fs",
    () =>
      createFsSketchpadStore(
        fs.mkdtempSync(path.join(os.tmpdir(), "val-sketchpads-")),
        now,
      ),
  ],
])("the %s store", (_, makeStore) => {
  let store: SketchpadStore;
  beforeEach(() => {
    store = makeStore();
  });

  test("keeps what it makes, at version 1", async () => {
    const made = await store.create({
      text: SKETCH,
      title: "Our people",
      page: "/people",
      by: "fredrik",
    });
    expect(made).toMatchObject({
      page: "/people",
      version: 1,
      archived: false,
      createdBy: "fredrik",
    });
    expect(await store.get(made.id)).toEqual(made);
  });

  test("a change made on the current version lands, and moves it on", async () => {
    const made = await store.create({
      text: SKETCH,
      title: null,
      page: null,
      by: null,
    });
    const result = await store.update(made.id, {
      baseVersion: 1,
      text: OTHER,
      page: "/about",
      by: "kari",
    });
    expect(result).toMatchObject({
      status: "updated",
      sketchpad: { text: OTHER, page: "/about", version: 2, updatedBy: "kari" },
    });
  });

  test("a change made on an old version is refused, with how it is now", async () => {
    const made = await store.create({
      text: SKETCH,
      title: null,
      page: null,
      by: null,
    });
    await store.update(made.id, { baseVersion: 1, text: OTHER, by: null });
    const result = await store.update(made.id, {
      baseVersion: 1,
      text: SKETCH,
      by: null,
    });
    expect(result).toMatchObject({
      status: "conflict",
      sketchpad: { text: OTHER, version: 2 },
    });
  });

  test("two changes on one version: one lands, the other is told", async () => {
    const made = await store.create({
      text: SKETCH,
      title: null,
      page: null,
      by: null,
    });
    const results = await Promise.all([
      store.update(made.id, { baseVersion: 1, text: OTHER, by: "a" }),
      store.update(made.id, { baseVersion: 1, page: "/x", by: "b" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "conflict",
      "updated",
    ]);
  });

  test("lists newest first, leaving out archived ones unless asked", async () => {
    const first = await store.create({
      text: SKETCH,
      title: null,
      page: "/a",
      by: null,
    });
    const second = await store.create({
      text: SKETCH,
      title: null,
      page: "/b",
      by: null,
    });
    await store.update(first.id, { baseVersion: 1, archived: true, by: null });
    const ids = async (archived: "exclude" | "include" | "only") =>
      (await store.list({ archived })).map((s) => s.id);
    expect(await ids("exclude")).toEqual([second.id]);
    expect(await ids("only")).toEqual([first.id]);
    expect(await ids("include")).toEqual([first.id, second.id]);
    expect(
      (await store.list({ archived: "include", page: "/b" })).map((s) => s.id),
    ).toEqual([second.id]);
    expect((await store.list({ archived: "include" }))[0]).not.toHaveProperty(
      "text",
    );
  });

  test("an id it never made is not found", async () => {
    expect(await store.get(newSketchpadId())).toBeNull();
    expect(
      await store.update(newSketchpadId(), { baseVersion: 1, by: null }),
    ).toEqual({ status: "not-found" });
  });
});

test("the fs store never reads outside its directory", async () => {
  const store = createFsSketchpadStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "val-sketchpads-")),
  );
  expect(await store.get("../../etc/passwd")).toBeNull();
});

test("ids look like UUIDs, and are different", () => {
  const a = newSketchpadId();
  expect(a).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(newSketchpadId()).not.toBe(a);
});

describe("the routes", () => {
  type Auth = { error: string | null; id: string | null };
  const routes = (auth: Auth = { error: null, id: "fredrik" }) =>
    createSketchpadRoutes({
      store: (() => {
        const store = createMemorySketchpadStore(now);
        return () => store;
      })(),
      getAuth: () => auth,
      profileOf: (a) => a.id,
    });
  const cookies = { val_session: undefined };

  async function made(r: ReturnType<typeof routes>, text = SKETCH) {
    const res = await r["/sketchpads"].POST({
      body: { text, page: "/people" },
      cookies,
    });
    if (res.status !== 201) {
      throw new Error(JSON.stringify(res));
    }
    return res.json.sketchpad;
  }

  test("making one answers with its id, title and who made it", async () => {
    const sketchpad = await made(routes());
    expect(sketchpad).toMatchObject({
      title: "Our people",
      page: "/people",
      version: 1,
      createdBy: "fredrik",
    });
    expect(typeof sketchpad.id).toBe("string");
  });

  test("a text not in the one spelling is refused, line by line", async () => {
    const res = await routes()["/sketchpads"].POST({
      body: { text: "# Title\n\nText\n", page: null },
      cookies,
    });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ errors: [{ line: 2 }] });
  });

  test("a change on an old version is a 409 with the sketchpad as it is", async () => {
    const r = routes();
    const sketchpad = await made(r);
    await r["/sketchpad"].PATCH({
      body: { id: sketchpad.id, baseVersion: 1, text: OTHER },
      cookies,
    });
    const res = await r["/sketchpad"].PATCH({
      body: { id: sketchpad.id, baseVersion: 1, page: "/x" },
      cookies,
    });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ sketchpad: { version: 2, text: OTHER } });
  });

  test("an archived sketchpad is reopened before it changes", async () => {
    const r = routes();
    const sketchpad = await made(r);
    await r["/sketchpad"].PATCH({
      body: { id: sketchpad.id, baseVersion: 1, archived: true },
      cookies,
    });
    const refused = await r["/sketchpad"].PATCH({
      body: { id: sketchpad.id, baseVersion: 2, text: OTHER },
      cookies,
    });
    expect(refused.status).toBe(400);
    const reopened = await r["/sketchpad"].PATCH({
      body: { id: sketchpad.id, baseVersion: 2, text: OTHER, archived: false },
      cookies,
    });
    expect(reopened).toMatchObject({
      status: 200,
      json: { sketchpad: { archived: false, text: OTHER, version: 3 } },
    });
  });

  test("a changed text renames it after its heading", async () => {
    const r = routes();
    const sketchpad = await made(r);
    const res = await r["/sketchpad"].PATCH({
      body: { id: sketchpad.id, baseVersion: 1, text: "# Careers\n" },
      cookies,
    });
    expect(res).toMatchObject({ json: { sketchpad: { title: "Careers" } } });
  });

  test("an unknown id is a 404, and nobody signed in is a 401", async () => {
    expect(
      (
        await routes()["/sketchpad"].GET({
          query: { id: newSketchpadId() },
          cookies,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await routes({ error: "Not signed in", id: null })["/sketchpads"].GET({
          query: { archived: undefined, page: undefined },
          cookies,
        })
      ).status,
    ).toBe(401);
  });
});

describe("the http store", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const sketchpad = {
    id: newSketchpadId(),
    page: null,
    title: null,
    text: SKETCH,
    version: 2,
    archived: false,
    createdAt: "2026-10-27T12:00:00.000Z",
    updatedAt: "2026-10-27T12:00:00.000Z",
    createdBy: null,
    updatedBy: null,
  };
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    calls.length = 0;
  });
  const answer = (status: number, json: unknown) => {
    global.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(json), { status });
    }) as typeof fetch;
  };
  const store = createHttpSketchpadStore({
    url: "https://content.example/v1/org/project/sketchpads",
    headers: { Authorization: "Bearer key" },
  });

  test("a change goes to the sketchpad's address, saying who made it", async () => {
    answer(200, { sketchpad });
    await store.update(sketchpad.id, {
      baseVersion: 1,
      text: SKETCH,
      by: "kari",
    });
    expect(calls[0].url).toBe(
      `https://content.example/v1/org/project/sketchpads/${sketchpad.id}`,
    );
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer key",
      "x-val-profile-id": "kari",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      baseVersion: 1,
      text: SKETCH,
    });
  });

  test("a 409 is a conflict carrying the sketchpad as it is", async () => {
    answer(409, { message: "changed", sketchpad });
    expect(
      await store.update(sketchpad.id, { baseVersion: 1, by: null }),
    ).toEqual({ status: "conflict", sketchpad });
  });

  test("a 404 is not found, and a list carries the filter", async () => {
    answer(404, { message: "no" });
    expect(await store.get(sketchpad.id)).toBeNull();
    answer(200, { sketchpads: [] });
    await store.list({ archived: "only", page: "/a" });
    expect(calls[calls.length - 1].url).toBe(
      "https://content.example/v1/org/project/sketchpads?archived=only&page=%2Fa",
    );
  });
});
