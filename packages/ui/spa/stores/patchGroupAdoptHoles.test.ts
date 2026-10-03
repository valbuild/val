import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import type { PatchGroupT } from "@valbuild/shared/internal";
import { createSystem } from "./createSystem";
import type { PatchRecord } from "./types";

/**
 * Adopting another tab's change never puts a hole in a patch set.
 *
 * This tab unstages `insert`, an array insert. Another tab of the same user,
 * still showing it, edits the inserted item; that write's closure puts `insert`
 * back in the group on the server, so the group now lists both. `insert` was
 * taken out HERE, and stays out — but `edit` was written on top of it, its
 * index computed against a list that had the item. Adopting `edit` alone is a
 * hole in the middle of a patch set: applied without the insert it writes to
 * the wrong element. So it is not adopted, while a change elsewhere that needs
 * nothing taken out still is.
 */

const LIST = "/list.val.ts" as ModuleFilePath;
const OTHER = "/other.val.ts" as ModuleFilePath;
const ME = "author-me";

const project = () => {
  const { c, s } = initVal();
  return [
    c.define(LIST, s.object({ items: s.array(s.string()) }), {
      items: ["one"],
    }),
    c.define(OTHER, s.object({ title: s.string() }), { title: "base" }),
  ];
};

const insert = "insert" as PatchId;
const edit = "edit" as PatchId;
const unrelated = "unrelated" as PatchId;

const records: Record<string, PatchRecord> = {
  insert: {
    patchId: insert,
    moduleFilePath: LIST,
    patch: [{ op: "add", path: ["items", "0"], value: "new" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    authorId: ME,
    appliedAt: null,
  },
  edit: {
    patchId: edit,
    moduleFilePath: LIST,
    patch: [{ op: "replace", path: ["items", "0"], value: "new, edited" }],
    createdAt: "2026-01-01T00:00:01.000Z",
    authorId: ME,
    appliedAt: null,
  },
  unrelated: {
    patchId: unrelated,
    moduleFilePath: OTHER,
    patch: [{ op: "replace", path: ["title"], value: "elsewhere" }],
    createdAt: "2026-01-01T00:00:02.000Z",
    authorId: ME,
    appliedAt: null,
  },
};

function group(patchIds: PatchId[]): PatchGroupT {
  return {
    patchGroupId: "g-mine",
    authorId: ME,
    createdAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    patchIds,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a change written on top of one this tab unstaged is not adopted alone", async () => {
  let annotation = [group([insert])];
  const system = createSystem({
    fetchPatches: async (patchIds) => ({
      patches: patchIds.flatMap((patchId) =>
        records[patchId] ? [records[patchId]] : [],
      ),
      patchGroups: annotation,
    }),
    createPatchId: () => "local" as PatchId,
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  system.setOwnPatchGroupId("g-mine");
  system.seedPatchGroup([]);

  system.stat.receiveStat({ patches: [insert], baseSha: "sha" });
  await system.patchSync.flush();
  await settle();
  expect(system.patchGroup()).toContain(insert);

  // Unstaged here.
  system.setPatchGroup([]);

  // The other tab edits the inserted item; its closure re-stages the insert.
  annotation = [group([insert, edit, unrelated])];
  system.stat.receiveStat({
    patches: [insert, edit, unrelated],
    baseSha: "sha",
  });
  await system.patchSync.flush();
  for (let i = 0; i < 5; i++) await settle();

  const scope = system.patchGroup() ?? [];
  expect(scope).not.toContain(insert);
  // The hole: `edit` without the insert beneath it.
  expect(scope).not.toContain(edit);
  // And a change that needs nothing taken out is adopted as before.
  expect(scope).toContain(unrelated);
});
