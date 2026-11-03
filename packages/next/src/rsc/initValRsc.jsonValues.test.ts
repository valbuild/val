import { randomUUID } from "crypto";
import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { raw } from "@valbuild/react/stega";
import { InMemoryPatchStore } from "@valbuild/server";
import { createValRuntime, headWork } from "@valbuild/server/internal";
import { initFetchValKeyStega } from "./initValRsc";

const { s, c, config } = initVal();

const PAGES = "/pages.val.ts" as ModuleFilePath;

/**
 * A `.jsonValues()` module whose entries resolve through their local thunks —
 * i.e. the COMMITTED content, which is what production reads.
 */
const pagesVal = c.define(
  PAGES,
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
    "/a": c.json(() => Promise.resolve({ default: { title: "committed A" } })),
  },
);

/** A real runtime in memory mode, with these edits pending. */
async function runtimeWith(...patches: Patch[]) {
  const valModules: ValModules = {
    config,
    modules: [{ def: async () => ({ default: pagesVal }) }],
  };
  const runtime = createValRuntime(
    valModules,
    "/api/val",
    {
      ...config,
      sourceFiles: {},
      patchStore: new InMemoryPatchStore(),
      unsafelyAllowUnauthenticated: true,
    },
    config,
  );
  for (const patch of patches) {
    await (
      await runtime
    ).ops.createPatch(
      PAGES,
      patch,
      randomUUID() as PatchId,
      {
        type: "head",
        headBaseSha: await (await runtime).ops.getBaseSha(),
      },
      null,
      null,
    );
  }
  return runtime;
}

const cookies = async () => ({
  get: (name: string) => ({ name, value: "session" }),
});

/**
 * In enabled (draft) mode the reader stega-encodes what it returns, so the
 * click-to-edit tag rides along invisibly inside the string. `raw` strips it, the
 * same way consumer code does when it needs the plain value.
 */
function titleOf(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const title = (entry as { title?: unknown }).title;
  return typeof title === "string" ? raw(title) : undefined;
}

describe("fetchValKey draft state", () => {
  test("draft content wins over the committed entry", async () => {
    const runtime = runtimeWith([
      { op: "replace", path: ["/a", "title"], value: "draft A" },
    ]);
    const fetchValKey = initFetchValKeyStega({
      runtime,
      isEnabled: async () => true,
      getCookies: cookies,
    });
    expect(titleOf(await fetchValKey(pagesVal, "/a"))).toBe("draft A");
  });

  test("an entry DELETED in the draft state renders nothing", async () => {
    // Regression: "deleted in the draft" was once indistinguishable from
    // "could not ask", so the reader fell back to the committed entry and
    // rendered a page the editor had just deleted.
    const runtime = runtimeWith([{ op: "remove", path: ["/a"] }]);
    const fetchValKey = initFetchValKeyStega({
      runtime,
      isEnabled: async () => true,
      getCookies: cookies,
    });
    expect(await fetchValKey(pagesVal, "/a")).toBeUndefined();
  });

  test("an entry ADDED in the draft state is reachable", async () => {
    // Its key exists only in a pending patch, so the local source knows nothing
    // about it: the answer can only come from the draft read.
    const runtime = runtimeWith([
      { op: "add", path: ["/b"], value: { title: "drafted B" } },
    ]);
    const fetchValKey = initFetchValKeyStega({
      runtime,
      isEnabled: async () => true,
      getCookies: cookies,
    });
    expect(titleOf(await fetchValKey(pagesVal, "/b"))).toBe("drafted B");
  });

  test("a runtime that fails falls back to the committed entry rather than blanking", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fetchValKey = initFetchValKeyStega({
        runtime: Promise.reject(new Error("boom")),
        isEnabled: async () => true,
        getCookies: cookies,
      });
      expect(titleOf(await fetchValKey(pagesVal, "/a"))).toBe("committed A");
    } finally {
      error.mockRestore();
    }
  });

  test("disabled (production) never reads the draft", async () => {
    const runtime = runtimeWith([
      { op: "replace", path: ["/a", "title"], value: "draft A" },
    ]);
    const before = headWork().seqReads;
    const fetchValKey = initFetchValKeyStega({
      runtime,
      isEnabled: async () => false,
      getCookies: cookies,
    });
    expect(titleOf(await fetchValKey(pagesVal, "/a"))).toBe("committed A");
    expect(headWork().seqReads).toBe(before);
  });
});
