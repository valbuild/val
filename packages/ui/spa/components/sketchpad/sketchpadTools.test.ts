import { checkSketch, type SketchpadT } from "@valbuild/shared/internal";
import type { SketchpadClient, SketchpadResult } from "./sketchpadClient";
import { SketchpadsState } from "./SketchpadsState";
import { runSketchpadTool } from "./sketchpadTools";

/** The server's rules, in a few lines: enough to see what the tools do with its answers. */
function fakeClient(): SketchpadClient {
  const all = new Map<string, SketchpadT>();
  let next = 1;
  const refuse = (text: string): SketchpadResult | null => {
    const errors = checkSketch(text);
    return errors.length > 0
      ? { status: "refused", message: "Not a sketch", errors }
      : null;
  };
  return {
    async list() {
      return {
        status: "ok",
        sketchpads: Array.from(all.values()).map(({ text, ...rest }) => {
          void text;
          return rest;
        }),
      };
    },
    async get(id) {
      const found = all.get(id);
      return found
        ? { status: "ok", sketchpad: found }
        : { status: "not-found", message: "No such sketchpad" };
    },
    async create({ text, page }) {
      const refused = refuse(text);
      if (refused) {
        return refused;
      }
      const sketchpad: SketchpadT = {
        id: `pad-${next++}`,
        page,
        title: null,
        text,
        version: 1,
        archived: false,
        createdAt: "2026-10-27T12:00:00.000Z",
        updatedAt: "2026-10-27T12:00:00.000Z",
        createdBy: null,
        updatedBy: null,
      };
      all.set(sketchpad.id, sketchpad);
      return { status: "ok", sketchpad };
    },
    async update({ id, baseVersion, ...change }) {
      const current = all.get(id);
      if (!current) {
        return { status: "not-found", message: "No such sketchpad" };
      }
      if (current.version !== baseVersion) {
        return { status: "conflict", message: "Changed", sketchpad: current };
      }
      if (change.text !== undefined) {
        const refused = refuse(change.text);
        if (refused) {
          return refused;
        }
      }
      const updated = { ...current, ...change, version: current.version + 1 };
      all.set(id, updated);
      return { status: "ok", sketchpad: updated };
    },
  };
}

const SKETCH = "# Our people\n[hero: The team]\n";

describe("the sketchpad tools", () => {
  test("making one returns its id, keeps it and opens it", async () => {
    const state = new SketchpadsState();
    const outcome = await runSketchpadTool(
      "create_sketchpad",
      { text: SKETCH, page: "/people" },
      { client: fakeClient(), state },
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.result).toMatchObject({ id: "pad-1", version: 1 });
    expect(state.getSnapshot().openId).toBe("pad-1");
    expect(state.getSnapshot().byId["pad-1"].text).toBe(SKETCH);
  });

  test('"" is no page', async () => {
    const client = fakeClient();
    await runSketchpadTool(
      "create_sketchpad",
      { text: SKETCH, page: "" },
      { client, state: null },
    );
    expect((await client.get("pad-1")).status === "ok").toBe(true);
    const read = await runSketchpadTool(
      "read_sketchpad",
      { id: "pad-1" },
      { client, state: null },
    );
    expect(read.result).toMatchObject({ page: null });
  });

  test("a text not in the format comes back as the lines to fix", async () => {
    const outcome = await runSketchpadTool(
      "create_sketchpad",
      { text: "# Title\n\nText\n" },
      { client: fakeClient(), state: null },
    );
    expect(outcome).toMatchObject({
      isError: true,
      result: { errors: [{ line: 2 }] },
    });
  });

  test("a write on an old version comes back with the sketchpad as it is", async () => {
    const client = fakeClient();
    const deps = { client, state: null };
    await runSketchpadTool("create_sketchpad", { text: SKETCH }, deps);
    await runSketchpadTool(
      "write_sketchpad",
      { id: "pad-1", baseVersion: 1, text: "# Changed\n" },
      deps,
    );
    const outcome = await runSketchpadTool(
      "write_sketchpad",
      { id: "pad-1", baseVersion: 1, text: SKETCH },
      deps,
    );
    expect(outcome).toMatchObject({
      isError: true,
      result: { current: { version: 2, text: "# Changed\n" } },
    });
  });

  test("a write does not switch away from another sketchpad on screen", async () => {
    const client = fakeClient();
    const state = new SketchpadsState();
    await runSketchpadTool(
      "create_sketchpad",
      { text: SKETCH },
      { client, state },
    );
    await runSketchpadTool(
      "create_sketchpad",
      { text: SKETCH },
      { client, state },
    );
    expect(state.getSnapshot().openId).toBe("pad-2");
    await runSketchpadTool(
      "write_sketchpad",
      { id: "pad-1", baseVersion: 1, text: "# Other\n" },
      { client, state },
    );
    expect(state.getSnapshot().openId).toBe("pad-2");
    expect(state.getSnapshot().byId["pad-1"].version).toBe(2);
  });

  test("arguments that are not what the tool takes are an error, not a throw", async () => {
    const outcome = await runSketchpadTool(
      "write_sketchpad",
      { id: "pad-1" },
      { client: fakeClient(), state: null },
    );
    expect(outcome.isError).toBe(true);
  });
});

describe("SketchpadsState", () => {
  test("keeps the newest version it is given", () => {
    const state = new SketchpadsState();
    const base = {
      id: "a",
      page: null,
      title: null,
      text: "",
      archived: false,
      createdAt: "",
      updatedAt: "",
      createdBy: null,
      updatedBy: null,
    };
    state.put({ ...base, version: 3, text: "three\n" });
    state.put({ ...base, version: 2, text: "two\n" });
    expect(state.getSnapshot().byId.a.text).toBe("three\n");
  });

  test("sends to the chat only while one is registered", () => {
    const state = new SketchpadsState();
    expect(state.sendToAssistant("hi")).toBe(false);
    const sent: string[] = [];
    const unregister = state.registerAssistant((m) => {
      sent.push(m);
      return true;
    });
    expect(state.sendToAssistant("hi")).toBe(true);
    unregister();
    expect(state.sendToAssistant("again")).toBe(false);
    expect(sent).toEqual(["hi"]);
  });
});
