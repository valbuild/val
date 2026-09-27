import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { createSystem } from "./createSystem";
import type { RequestPublish } from "./PublishSeam";
import { sp } from "./testSystem";

/**
 * A managed project's Publish is a REQUEST for a publish job (valbuild/home,
 * docs/app-mode.md, "Publishing is a queued job"): the same gate, and then
 * nothing committed. The job takes the changes, and content seals them.
 */
const project = () => {
  const { c, s } = initVal();
  return [
    c.define("/a.val.ts", s.object({ title: s.string().minLength(2) }), {
      title: "original",
    }),
  ];
};

function makeSystem(requestPublish?: RequestPublish) {
  const commits: PatchId[][] = [];
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: (() => {
      let next = 0;
      return () => `req-${++next}` as PatchId;
    })(),
    mode: "http",
    publishPatches: async (request) => {
      commits.push(request.patchIds);
      return { status: "published" };
    },
    ...(requestPublish ? { requestPublish } : {}),
  });
  system.host.receive(project());
  return { system, commits };
}

const edit = async (
  system: ReturnType<typeof makeSystem>["system"],
  value: string,
) => {
  const patch = await system.patchStore.createPatch(
    "/a.val.ts" as ModuleFilePath,
    [{ op: "replace", path: ["title"], value }],
  );
  if (patch.status !== "created") throw new Error("not created");
  return patch.record.patchId;
};

test("a request is pressed after the gate, and commits nothing", async () => {
  let pressed = 0;
  const { system, commits } = makeSystem(async () => {
    pressed++;
    return {
      status: "requested",
      requestId: "r1",
      request: { kind: "publishing" },
      job: { id: "J1", step: "prepare", base: null, patches: ["req-1"] },
    };
  });
  const patchId = await edit(system, "requested value");
  const res = await system.publish([patchId], "summary", { request: true });
  expect(res).toMatchObject({ status: "requested", requestId: "r1" });
  expect(pressed).toBe(1);
  expect(commits).toEqual([]);
  // Nothing is published until content seals it: the change stays a change.
  expect(system.patchStore.allRecords()).toHaveLength(1);
  expect(system.sourceStore.peek(sp('/a.val.ts?p="title"'))).toMatchObject({
    data: "requested value",
  });
  system.dispose();
});

test("the gate still refuses a change that does not validate", async () => {
  let pressed = 0;
  const { system } = makeSystem(async () => {
    pressed++;
    return {
      status: "requested",
      requestId: "r1",
      request: { kind: "publishing" },
      job: null,
    };
  });
  const patchId = await edit(system, "x"); // minLength(2)
  const res = await system.publish([patchId], "summary", { request: true });
  expect(res.status).toBe("refused");
  expect(pressed).toBe(0);
  system.dispose();
});

test("a press content refused is a failure that can be retried", async () => {
  const { system } = makeSystem(async () => ({
    status: "error",
    message: "content is down",
  }));
  const patchId = await edit(system, "fine value");
  expect(await system.publish([patchId], "summary", { request: true })).toEqual(
    { status: "failed", message: "content is down", retryable: true },
  );
  system.dispose();
});

test("a system that cannot request says so rather than committing", async () => {
  const { system, commits } = makeSystem();
  const patchId = await edit(system, "fine value");
  const res = await system.publish([patchId], "summary", { request: true });
  expect(res).toMatchObject({ status: "failed", retryable: false });
  expect(commits).toEqual([]);
  system.dispose();
});
