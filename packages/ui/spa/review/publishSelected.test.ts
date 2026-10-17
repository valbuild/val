import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { PatchSets } from "../utils/PatchSets";
import {
  planSelection,
  publishSelectedClient,
  runPublishSelected,
} from "./publishSelected";

const { s } = initVal();
const PAGE = "/content/page.val.ts" as ModuleFilePath;
const schema = s
  .object({ title: s.string(), list: s.array(s.string()) })
  ["executeSerialize"]();

function patchSets(changes: { id: string; author: string; patch: Patch }[]) {
  const sets = new PatchSets();
  for (const change of changes) {
    sets.insert(
      PAGE,
      schema,
      change.patch,
      change.id as PatchId,
      "2026-10-17T00:00:00Z",
      change.author,
    );
  }
  return sets.serialize();
}

describe("planSelection", () => {
  const sets = patchSets([
    {
      id: "kari-adds",
      author: "kari",
      patch: [{ op: "add", path: ["list", "0"], value: "first" }],
    },
    {
      id: "ada-title",
      author: "ada",
      patch: [{ op: "replace", path: ["title"], value: "Hello" }],
    },
    {
      id: "ada-item",
      author: "ada",
      patch: [{ op: "replace", path: ["list", "0"], value: "First" }],
    },
  ]);

  test("says what comes with the selection, and whose it is", () => {
    const plan = planSelection(sets, ["ada-item" as PatchId]);
    expect([...plan.patchIds].sort()).toEqual(["ada-item", "kari-adds"]);
    expect(plan.added).toEqual(["kari-adds"]);
    expect(plan.addedAuthors).toEqual(["kari"]);
  });

  test("a selection that is whole sets adds nothing", () => {
    const plan = planSelection(sets, ["ada-title" as PatchId]);
    expect(plan.patchIds).toEqual(["ada-title"]);
    expect(plan.added).toEqual([]);
  });
});

describe("runPublishSelected", () => {
  const ids = ["a"] as PatchId[];
  const ok = async () => ({ status: "ok" as const });

  test("saves, moves, then publishes the proposal it was moved into", async () => {
    const steps: string[] = [];
    const result = await runPublishSelected({
      save: async (patchIds) => {
        steps.push(`save ${patchIds.join()}`);
        return { status: "ok" };
      },
      move: async (body) => {
        steps.push(`move ${body.patchIds.join()} as ${body.requestId}`);
        return { status: "moved", proposal: "p1" };
      },
      publish: async (proposal) => {
        steps.push(`publish ${proposal}`);
        return { status: "requested" };
      },
      patchIds: ids,
      displayName: "1 change",
      requestId: "press-1",
    });
    expect(result).toEqual({ status: "pressed", proposal: "p1" });
    expect(steps).toEqual(["save a", "move a as press-1", "publish p1"]);
  });

  test("not saved: nothing moves, and it says so", async () => {
    const move = jest.fn();
    const result = await runPublishSelected({
      save: async () => ({ status: "error", message: "Val Build is slow." }),
      move,
      publish: async () => ({ status: "requested" }),
      patchIds: ids,
      displayName: "1 change",
      requestId: "press-1",
    });
    expect(result).toEqual({
      status: "error",
      message:
        "Nothing was published: the changes are not saved yet. Val Build is slow.",
      proposal: null,
    });
    expect(move).not.toHaveBeenCalled();
  });

  test("a publish that could not start names the proposal the changes are safe in", async () => {
    const result = await runPublishSelected({
      save: ok,
      move: async () => ({ status: "moved", proposal: "p1" }),
      publish: async () => ({ status: "error", message: "busy" }),
      patchIds: ids,
      displayName: "1 change",
      requestId: "press-1",
    });
    expect(result).toEqual({
      status: "error",
      message:
        "The changes are in a proposal, and its publish could not start: busy",
      proposal: "p1",
    });
  });

  test("again, after the move: only the publish is pressed", async () => {
    const save = jest.fn();
    const move = jest.fn();
    const result = await runPublishSelected({
      save,
      move,
      publish: async () => ({ status: "requested" }),
      patchIds: ids,
      displayName: "1 change",
      requestId: "press-1",
      proposal: "p1",
    });
    expect(result).toEqual({ status: "pressed", proposal: "p1" });
    expect(save).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
  });
});

describe("publishSelectedClient", () => {
  const answering =
    (status: number, body: unknown): typeof fetch =>
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
  const body = {
    patchIds: ["a"] as PatchId[],
    displayName: "1 change",
    requestId: "press-1",
  };

  test("the proposal it moved them into", async () => {
    const move = publishSelectedClient({
      api: "/api/val",
      fetchImpl: answering(200, { proposal: "p1" }),
    });
    expect(await move(body)).toEqual({ status: "moved", proposal: "p1" });
  });

  test("moved but not saved there: the proposal still, so they can be found", async () => {
    const move = publishSelectedClient({
      api: "/api/val",
      fetchImpl: answering(502, { message: "not saved", proposal: "p1" }),
    });
    expect(await move(body)).toEqual({
      status: "error",
      message: "not saved",
      proposal: "p1",
    });
  });

  test("refused before anything moved: no proposal", async () => {
    const move = publishSelectedClient({
      api: "/api/val",
      fetchImpl: answering(409, { message: "The site was published" }),
    });
    expect(await move(body)).toEqual({
      status: "error",
      message: "The site was published",
      proposal: null,
    });
  });
});
