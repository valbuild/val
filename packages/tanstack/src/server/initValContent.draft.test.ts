import { randomUUID } from "crypto";
import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import {
  InMemoryPatchStore,
  createValRuntime,
  headWork,
  type ValRuntime,
} from "@valbuild/server";
import { initFetchValDraft } from "./initValContent";

/**
 * `fetchValDraft`: what a draft page is rendered with on the server, and what
 * the browser hydrates from. See `ValDraft`. Against a real runtime in memory
 * mode, its head the draft, with the edits written as the API writes them
 * (`createPatch`).
 */

const { s, c, config } = initVal();

const EDITED = "/content/edited.val.ts" as ModuleFilePath;
const UNTOUCHED = "/content/untouched.val.ts" as ModuleFilePath;
const KB = "/content/kb.val.ts" as ModuleFilePath;

const editedVal = c.define(EDITED, s.object({ text: s.string() }), {
  text: "published",
});
const untouchedVal = c.define(UNTOUCHED, s.object({ text: s.string() }), {
  text: "published",
});
const kbVal = c.define(
  KB,
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
    "edited-entry": c.json(async () => ({ default: { title: "published" } })),
    "other-entry": c.json(async () => ({ default: { title: "other" } })),
    unreadable: c.json(
      (): Promise<{ default: { title: string } }> =>
        Promise.reject(new Error("unreadable")),
    ),
  },
);

function runtimeOf(
  opts: { authenticated: boolean } = { authenticated: true },
): {
  runtime: Promise<ValRuntime>;
  edit: (path: ModuleFilePath, patch: Patch) => Promise<void>;
} {
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
      const ops = (await runtime).ops;
      await ops.createPatch(
        path,
        patch,
        randomUUID() as PatchId,
        { type: "head", headBaseSha: await ops.getBaseSha() },
        null,
        null,
      );
    },
  };
}

const cookies = (session: string | undefined) => async () => ({
  get: (name: string) =>
    session === undefined ? undefined : { name, value: session },
});

/** The versions the head read these modules at. */
async function versionsOf(
  runtime: Promise<ValRuntime>,
  ...paths: ModuleFilePath[]
) {
  const synced = await (await runtime).ops.head.sync();
  if ("error" in synced) throw new Error(synced.error.message);
  return Object.fromEntries(
    paths.map((path) => [path, synced.ok.versions[path]]),
  );
}

test("a visitor reads nothing and gets no draft", async () => {
  const { runtime } = runtimeOf();
  const before = headWork().seqReads;
  const fetchValDraft = initFetchValDraft({
    runtime,
    isEnabled: async () => false,
    getCookies: cookies(undefined),
  });
  expect(await fetchValDraft()).toBeNull();
  expect(headWork().seqReads).toBe(before);
});

test("in preview, the draft holds the modules it changes, with their versions, and no others", async () => {
  const { runtime, edit } = runtimeOf();
  await edit(EDITED, [{ op: "replace", path: ["text"], value: "DRAFT" }]);
  const fetchValDraft = initFetchValDraft({
    runtime,
    isEnabled: async () => true,
    getCookies: cookies("session"),
  });
  expect(await fetchValDraft()).toEqual({
    sources: { [EDITED]: { text: "DRAFT" } },
    versions: await versionsOf(runtime, EDITED),
  });
});

test("a second read, with nothing moved, reads no chain and makes nothing", async () => {
  const { runtime, edit } = runtimeOf();
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

test("a session the server refuses is published content, not an error", async () => {
  const { runtime, edit } = runtimeOf({ authenticated: false });
  await edit(EDITED, [{ op: "replace", path: ["text"], value: "DRAFT" }]);
  const fetchValDraft = initFetchValDraft({
    runtime,
    isEnabled: async () => true,
    getCookies: cookies("expired"),
  });
  expect(await fetchValDraft()).toBeNull();
});

test("a runtime that fails is published content, not a page that fails", async () => {
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

describe("a module of `.jsonValues()` entries", () => {
  test("the draft has the content of the entries it edits, and markers for the rest", async () => {
    const { runtime, edit } = runtimeOf();
    await edit(KB, [
      { op: "replace", path: ["edited-entry", "title"], value: "DRAFT" },
    ]);
    const fetchValDraft = initFetchValDraft({
      runtime,
      isEnabled: async () => true,
      getCookies: cookies("session"),
    });
    const draft = await fetchValDraft();
    expect(draft).toEqual({
      sources: {
        [KB]: {
          "edited-entry": { title: "DRAFT" },
          // The wire shape: what the Studio gets over HTTP, thunk and all gone.
          "other-entry": { _type: "json" },
          unreadable: { _type: "json" },
        },
      },
      versions: await versionsOf(runtime, KB),
    });
    // Sent from the server to the page, so it has to survive the trip.
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
  });

  test("an entry that cannot be read leaves the module out, rather than published in a draft", async () => {
    const { runtime, edit } = runtimeOf();
    await edit(KB, [
      { op: "replace", path: ["unreadable", "title"], value: "DRAFT" },
    ]);
    const fetchValDraft = initFetchValDraft({
      runtime,
      isEnabled: async () => true,
      getCookies: cookies("session"),
    });
    expect(await fetchValDraft()).toEqual({ sources: {}, versions: {} });
  });
});

describe("at a proposal's address", () => {
  // The proposal's saved Source: the third source provider. See `ValDraft`.
  const snapshot = { [UNTOUCHED]: { text: "saved in the proposal" } };

  test("the draft says it is a proposal's, which a visitor's page never is", async () => {
    // Content analytics counts a visitor's page and no other, and a proposal
    // is not the live site: `ValProvider` reads this, never the snapshot.
    const { runtime, edit } = runtimeOf();
    await edit(EDITED, [{ op: "replace", path: ["text"], value: "DRAFT" }]);
    const reviewer = initFetchValDraft({
      runtime,
      isEnabled: async () => false,
      getCookies: cookies(undefined),
      snapshot,
      atProposal: true,
    });
    expect(await reviewer()).toEqual({
      sources: {},
      snapshot,
      draftMode: false,
      atProposal: true,
    });
    const editor = initFetchValDraft({
      runtime,
      isEnabled: async () => true,
      getCookies: cookies("session"),
      snapshot,
      atProposal: true,
    });
    expect(await editor()).toEqual({
      sources: { [EDITED]: { text: "DRAFT" } },
      versions: await versionsOf(runtime, EDITED),
      snapshot,
      atProposal: true,
    });
  });

  test("a reviewer who is not editing still gets the proposal, and no draft", async () => {
    const { runtime } = runtimeOf();
    const before = headWork().seqReads;
    const fetchValDraft = initFetchValDraft({
      runtime,
      isEnabled: async () => false,
      getCookies: cookies(undefined),
      snapshot,
    });
    expect(await fetchValDraft()).toEqual({
      sources: {},
      snapshot,
      draftMode: false,
    });
    expect(headWork().seqReads).toBe(before);
  });

  test("a draft that cannot be read still leaves the proposal on the page", async () => {
    const { runtime } = runtimeOf({ authenticated: false });
    const fetchValDraft = initFetchValDraft({
      runtime,
      isEnabled: async () => true,
      getCookies: cookies("expired"),
      snapshot,
    });
    expect(await fetchValDraft()).toEqual({
      sources: {},
      snapshot,
      draftMode: false,
    });
  });
});

describe("on a site serving a content version", () => {
  // Content published without a build: the live site, over its bundle. The
  // readers get it as a snapshot, like a proposal's, and a visitor's page is
  // still a visitor's -- it was read as a proposal's, and no visitor of a
  // site that had published content without a build was ever counted.
  const snapshot = { [UNTOUCHED]: { text: "published without a build" } };

  test("a visitor gets the content version, and a draft that is not a proposal's", async () => {
    const { runtime } = runtimeOf();
    const fetchValDraft = initFetchValDraft({
      runtime,
      isEnabled: async () => false,
      getCookies: cookies(undefined),
      snapshot,
      atProposal: false,
    });
    const draft = await fetchValDraft();
    expect(draft).toEqual({ sources: {}, snapshot, draftMode: false });
    expect(draft?.atProposal).toBeUndefined();
  });
});
