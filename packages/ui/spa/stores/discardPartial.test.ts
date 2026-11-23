import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { createValClient } from "@valbuild/shared/internal";
import { createValSystem } from "./react/createValSystem";
import { SchemaValidator } from "../validation/validateModule";

// The default bridge starts a Vite worker (`import.meta.url`), which jest cannot
// load. Never reached: this test validates in-process through
// `schemaValidation`, as the scenario harness does (`noWorkerBridge.ts`).
jest.mock("../validation/schemaValidationBridge", () => ({
  createSchemaValidationBridge: () => {
    throw new Error("the worker bridge is not used in this test");
  },
}));

/**
 * A discard that refuses some changes and deletes the rest.
 *
 * Content refuses to discard a change a running publish holds -- and deletes
 * the others in the same request. The Studio used to hear only the refusal, so
 * it kept the deleted changes: shown, saved and published again, though they
 * no longer existed.
 *
 * Driven through the Studio's own `createValSystem` on the real client, with
 * only `fetch` faked: the server is the edge here. (The scenario harness has
 * the real server, but its in-memory store never refuses a single patch.)
 */
describe("a discard that only partly succeeds", () => {
  const MODULE = "/t.val.ts" as ModuleFilePath;
  const project = () => {
    const { c, s } = initVal();
    return [
      c.define(MODULE, s.object({ title: s.string(), body: s.string() }), {
        title: "base",
        body: "base",
      }),
    ];
  };

  type Sent = { method: string; path: string; body: unknown };

  function makeStudio() {
    const sent: Sent[] = [];
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    const fetch = async (input: string, init: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const method = init.method ?? "GET";
      const body =
        typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      sent.push({ method, path: url.pathname, body });
      if (url.pathname === "/api/val/patches" && method === "PUT") {
        const ids = (body as { patches: { patchId: PatchId }[] }).patches.map(
          (patch) => patch.patchId,
        );
        return json(200, {
          newPatchIds: ids,
          parentRef: { type: "patch", patchId: ids[ids.length - 1] },
          headVersion: 2,
        });
      }
      if (url.pathname === "/api/val/patches" && method === "DELETE") {
        const [first, second] = (body as { ids: PatchId[] }).ids;
        // What `ValServer` answers when content deleted `first` and refused
        // `second` because a publish holds it.
        return json(500, {
          message: "Failed to delete patches",
          errors: [
            {
              patchId: second,
              message: "It is being published right now.",
              publishJobId: "job-1",
            },
          ],
          deleted: [first],
          headVersion: 4,
        });
      }
      return json(404, { message: `not faked: ${method} ${url.pathname}` });
    };
    const client = createValClient("/api/val", null, { fetch });
    const validator = new SchemaValidator();
    const system = createValSystem(client, {
      writes: true,
      mode: "http",
      schemaValidation: {
        validate: async (moduleFilePath, source, serializedSchema, version) =>
          validator.validate(moduleFilePath, source, serializedSchema, version),
      },
    });
    system.host.receive(project());
    system.stat.receiveStat({ patches: [], baseSha: "sha", headVersion: 1 });
    return { system, sent };
  }

  async function write(
    system: ReturnType<typeof makeStudio>["system"],
    field: "title" | "body",
  ): Promise<PatchId> {
    const res = await system.patchStore.createPatch(MODULE, [
      { op: "replace", path: [field], value: "edited" },
    ]);
    if (res.status !== "created") {
      throw new Error(`createPatch failed: ${res.status}`);
    }
    await system.patchSync.flush();
    return res.record.patchId;
  }

  it("forgets the change that went and keeps the one that did not", async () => {
    const { system, sent } = makeStudio();
    const first = await write(system, "title");
    const second = await write(system, "body");

    const res = await system.discard([first, second]);

    expect(res).toEqual({
      status: "failed",
      message: "It is being published right now.",
      publishJobId: "job-1",
      discarded: [first],
    });
    expect(
      system.patchStore.allRecords().map((record) => record.patchId),
    ).toEqual([second]);
    // One request for the whole discard, with the ids in the body.
    expect(
      sent
        .filter((request) => request.method === "DELETE")
        .map((request) => request.body),
    ).toEqual([{ ids: [first, second], reportHeadVersion: true }]);
    system.dispose();
  });

  it("notes the version the deletes that went moved the chain to", async () => {
    const { system } = makeStudio();
    const first = await write(system, "title");
    const second = await write(system, "body");
    await system.discard([first, second]);

    // A stat read before the delete still names `first`: adopting it would
    // put the deleted change back.
    const adopted: PatchId[][] = [];
    const stop = system.stat.events.on("stat:receive", (event) => {
      adopted.push(event.patches);
    });
    system.stat.receiveStat({
      patches: [first, second],
      headPatchId: second,
      baseSha: "sha",
      headVersion: 3,
    });
    stop();

    expect(adopted).toEqual([]);
    system.dispose();
  });
});
