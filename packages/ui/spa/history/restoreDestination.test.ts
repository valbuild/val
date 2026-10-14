import type { PatchId } from "@valbuild/core";
import {
  landRestore,
  restoreCodeOf,
  withRestoreCode,
  withoutRestoreCode,
  restoreRequestId,
  type RestoreDestination,
  type SavePatches,
} from "./restoreDestination";

/**
 * Restore opens a proposal: on the site of a project with proposals, the
 * patches a restore wrote are saved, then moved into a new proposal as it is
 * made (valbuild/home `docs/hosted-publishing.md`, step 9).
 */
describe("where a restore goes", () => {
  const ids = ["b-patch", "a-patch"] as PatchId[];
  const saved: SavePatches = async () => ({ status: "ok" });

  test("here, it is staged and nothing else happens", async () => {
    const save = jest.fn(saved);
    expect(
      await landRestore({
        destination: { kind: "here" },
        save,
        patchIds: ids,
        displayName: "Restore",
      }),
    ).toEqual({ status: "staged" });
    expect(save).not.toHaveBeenCalled();
  });

  test("on the site, it is saved and then opens a proposal holding it", async () => {
    const calls: string[] = [];
    const destination: RestoreDestination = {
      kind: "proposal",
      open: async (input) => {
        calls.push(`open ${input.displayName} ${input.patchIds.join(",")}`);
      },
    };
    const result = await landRestore({
      destination,
      save: async (patchIds) => {
        calls.push(`save ${patchIds.join(",")}`);
        return { status: "ok" };
      },
      patchIds: ids,
      displayName: "Restore from 3 Oct",
    });
    expect(result).toEqual({ status: "opening" });
    // Saved first: content moves only changes it has.
    expect(calls).toEqual([
      "save b-patch,a-patch",
      "open Restore from 3 Oct b-patch,a-patch",
    ]);
  });

  test("a restore not saved yet opens nothing, and says so", async () => {
    const open = jest.fn(async () => {});
    const result = await landRestore({
      destination: { kind: "proposal", open },
      save: async () => ({ status: "error", message: "Not yet." }),
      patchIds: ids,
      displayName: "Restore",
    });
    expect(result.status).toBe("error");
    expect(open).not.toHaveBeenCalled();
  });

  test("a create that fails is reported, and a retry is the same create", async () => {
    const requestIds: string[] = [];
    let fail = true;
    const destination: RestoreDestination = {
      kind: "proposal",
      open: async (input) => {
        requestIds.push(input.requestId);
        if (fail) throw new Error("Val Build could not be reached.");
      },
    };
    const args = {
      destination,
      save: saved,
      patchIds: ids,
      displayName: "Restore",
    };
    const first = await landRestore(args);
    expect(first).toEqual({
      status: "error",
      message: expect.stringContaining("Val Build could not be reached."),
    });
    fail = false;
    expect(await landRestore(args)).toEqual({ status: "opening" });
    expect(requestIds).toEqual([restoreRequestId(ids), restoreRequestId(ids)]);
  });

  test("the request id is the same whatever order the patches are in, and content accepts it", () => {
    const a = restoreRequestId(["b", "a"] as PatchId[]);
    expect(a).toBe(restoreRequestId(["a", "b"] as PatchId[]));
    expect(
      restoreRequestId(["0f6c1e5a-6f43-4d6b-9e9c-3f1f1d2e8a77"] as PatchId[]),
    ).toMatch(/^[A-Za-z0-9_-]{1,100}$/);
  });

  test("nothing written, nothing opened", async () => {
    const open = jest.fn(async () => {});
    expect(
      await landRestore({
        destination: { kind: "proposal", open },
        save: saved,
        patchIds: [],
        displayName: "Restore",
      }),
    ).toEqual({ status: "staged" });
    expect(open).not.toHaveBeenCalled();
  });
});

describe("going back with the code, across addresses", () => {
  const COMMIT = "a".repeat(64);

  test("the site's Studio sends the commit along to the proposal's", async () => {
    const opened: unknown[] = [];
    await landRestore({
      destination: {
        kind: "proposal",
        open: async (input) => {
          opened.push(input.restoreCodeFrom);
        },
      },
      save: async () => ({ status: "ok" }),
      patchIds: ["a-patch"] as PatchId[],
      displayName: "Back to 3 Oct",
      restoreCodeFrom: COMMIT,
    });
    expect(opened).toEqual([COMMIT]);
  });

  test("the address carries it, keeps the page, and loses it once acted on", () => {
    const url = withRestoreCode(
      "https://p.example.com/val/history?commit=abc#x",
      COMMIT,
    );
    expect(restoreCodeOf(url)).toBe(COMMIT);
    const after = withoutRestoreCode(url);
    expect(restoreCodeOf(after)).toBeNull();
    expect(after).toBe("https://p.example.com/val/history?commit=abc#x");
  });

  test("anything that is not a commit sha is ignored", () => {
    expect(
      restoreCodeOf("https://p.example.com/val?val_restore_code=<script>"),
    ).toBeNull();
  });
});
