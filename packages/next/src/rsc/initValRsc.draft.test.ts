import { randomUUID } from "crypto";
import {
  Internal,
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { InMemoryPatchStore } from "@valbuild/server";
import {
  createValRuntime,
  headWork,
  type ValRuntime,
} from "@valbuild/server/internal";
import type { ComponentProps } from "react";
import type { ValNextProvider } from "../ValNextProvider";
import { initFetchValDraft } from "./initValRsc";

/**
 * `fetchValDraft` from `initValRsc`: what `<ValProvider draft>` is given, so a
 * draft page is rendered as the draft on the server and hydrated from the
 * same thing. The read is `readDraftChanges` in `@valbuild/server`, over the
 * runtime's head, which `@valbuild/tanstack/server`'s `fetchValDraft` is too;
 * these pin that Next's answers what TanStack's does
 * (`initValContent.draft.test.ts`), from Next's request context. Against a
 * real runtime in memory mode, with the edits written as the API writes them
 * (`createPatch`).
 */

const { s, c, config } = initVal();

const editedVal = c.define(
  "/app/edited/page.val.ts",
  s.object({ text: s.string() }),
  { text: "published" },
);
const untouchedVal = c.define(
  "/app/untouched/page.val.ts",
  s.object({ text: s.string() }),
  { text: "published" },
);
const kbVal = c.define(
  "/app/kb/page.val.ts",
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
    "edited-entry": c.json(async () => ({ default: { title: "published" } })),
    "other-entry": c.json(async () => ({ default: { title: "other" } })),
  },
);
const EDITED = Internal.getValPath(editedVal) as unknown as ModuleFilePath;
const KB = Internal.getValPath(kbVal) as unknown as ModuleFilePath;

async function runtimeOf(opts: { authenticated: boolean }): Promise<{
  runtime: Promise<ValRuntime>;
  edit: (path: ModuleFilePath, patch: Patch) => Promise<void>;
}> {
  const valModules: ValModules = {
    config,
    modules: [editedVal, untouchedVal, kbVal].map((module) => ({
      def: async () => ({ default: module }),
    })),
  };
  const runtime = createValRuntime(
    valModules,
    "/api/val",
    {
      ...config,
      sourceFiles: {},
      patchStore: new InMemoryPatchStore(),
      unsafelyAllowUnauthenticated: opts.authenticated,
    },
    config,
  );
  return {
    runtime,
    edit: async (path, patch) => {
      const res = await (
        await runtime
      ).ops.createPatch(
        path,
        patch,
        randomUUID() as PatchId,
        {
          type: "head",
          headBaseSha: await (await runtime).ops.getBaseSha(),
        },
        null,
        null,
      );
      if ("error" in res && res.error) throw new Error("could not edit");
    },
  };
}

/** What `cookies()` from `next/headers` answers, as far as Val reads it. */
const cookies = (session: string | undefined) => async () => ({
  get: (name: string) =>
    session === undefined ? undefined : { name, value: session },
});

test("outside draft mode it reads nothing and gives no draft", async () => {
  const { runtime } = await runtimeOf({ authenticated: true });
  const readCookies = jest.fn(cookies(undefined));
  const before = headWork().seqReads;
  const fetchValDraft = initFetchValDraft({
    runtime,
    isEnabled: async () => false,
    getCookies: readCookies,
  });
  expect(await fetchValDraft()).toBeNull();
  // `cookies()` makes a Next route dynamic: a visitor's request never asks.
  expect(readCookies).not.toHaveBeenCalled();
  expect(headWork().seqReads).toBe(before);
});

test("in draft mode, the draft holds the modules it changes, with their versions, and no others", async () => {
  const { runtime, edit } = await runtimeOf({ authenticated: true });
  await edit(EDITED, [{ op: "replace", path: ["text"], value: "DRAFT" }]);
  const fetchValDraft = initFetchValDraft({
    runtime,
    isEnabled: async () => true,
    getCookies: cookies("session"),
  });
  const draft = await fetchValDraft();
  expect(draft?.sources).toEqual({ [EDITED]: { text: "DRAFT" } });
  // The version the head read it at: the page compares the Studio's relay
  // with it instead of with the content.
  const manifest = await (await runtime).ops.head.sync();
  if ("error" in manifest) throw new Error(manifest.error.message);
  expect(draft?.versions).toEqual({
    [EDITED]: manifest.ok.versions[EDITED],
  });
  // What `ValProvider` takes, as it is: no conversion between the two.
  const prop: ComponentProps<typeof ValNextProvider>["draft"] = draft;
  expect(prop).toBe(draft);
  // Passed from a Server Component to a Client one, so it has to survive
  // the trip.
  expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
});

test("a second read, with nothing moved, reads no chain", async () => {
  const { runtime, edit } = await runtimeOf({ authenticated: true });
  await edit(EDITED, [{ op: "replace", path: ["text"], value: "DRAFT" }]);
  const fetchValDraft = initFetchValDraft({
    runtime,
    isEnabled: async () => true,
    getCookies: cookies("session"),
  });
  await fetchValDraft();
  const before = headWork();
  await fetchValDraft();
  expect(headWork().chainReads).toBe(before.chainReads);
  expect(headWork().materialized).toBe(before.materialized);
});

test("a session the server refuses is the published page, not an error", async () => {
  const { runtime, edit } = await runtimeOf({ authenticated: false });
  await edit(EDITED, [{ op: "replace", path: ["text"], value: "DRAFT" }]);
  const fetchValDraft = initFetchValDraft({
    runtime,
    isEnabled: async () => true,
    getCookies: cookies("stale"),
  });
  expect(await fetchValDraft()).toBeNull();
});

test("a runtime that fails is the published page, not a page that fails", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const fetchValDraft = initFetchValDraft({
      runtime: Promise.reject(new Error("boom")),
      isEnabled: async () => true,
      getCookies: cookies("session"),
    });
    expect(await fetchValDraft()).toBeNull();
  } finally {
    error.mockRestore();
  }
});

test("outside a request (draftMode() throws) it is the published page", async () => {
  const { runtime } = await runtimeOf({ authenticated: true });
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  const before = headWork().seqReads;
  try {
    const fetchValDraft = initFetchValDraft({
      runtime,
      isEnabled: async () => {
        throw new Error("`draftMode` was called outside a request scope.");
      },
      getCookies: cookies("session"),
    });
    expect(await fetchValDraft()).toBeNull();
    expect(headWork().seqReads).toBe(before);
  } finally {
    error.mockRestore();
  }
});

test("a `.jsonValues()` module has the entries the draft edits, and markers for the rest", async () => {
  const { runtime, edit } = await runtimeOf({ authenticated: true });
  await edit(KB, [
    { op: "replace", path: ["edited-entry", "title"], value: "DRAFT" },
  ]);
  const fetchValDraft = initFetchValDraft({
    runtime,
    isEnabled: async () => true,
    getCookies: cookies("session"),
  });
  const draft = await fetchValDraft();
  expect(draft?.sources).toEqual({
    [KB]: {
      "edited-entry": { title: "DRAFT" },
      "other-entry": { _type: "json" },
    },
  });
});
