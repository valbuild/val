/**
 * @jest-environment jsdom
 */
import "../stores/react/testPolyfills";
import { act, render } from "@testing-library/react";
import {
  initVal,
  type ModuleFilePath,
  type SourcePath,
  type ValModules,
} from "@valbuild/core";
import type { ValClient } from "@valbuild/shared/internal";
import { ValSyncEngine } from "../ValSyncEngine";
import { createSystem, type System } from "../stores/createSystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { ValFieldProvider, useAddPatch } from "./ValFieldProvider";

/**
 * The write path, after the flip: the STORE writes and the engine follows.
 *
 * `useAddPatch` is the single choke point for field writes. It mints the patch id,
 * applies the patch locally in the engine so every un-ported component still sees
 * it, and creates the patch in the store — which is what issues the `PUT`.
 *
 * It used to be the other way round, and the reason it flipped is worth keeping:
 * with both systems holding the same edit, the two chains have to agree on patch
 * IDENTITY, and they cannot. The engine merges consecutive keystrokes into one
 * patch; the store creates one per edit. So the engine held one id where the store
 * held six, and once `/stat` was wired in the store did not recognise the engine's
 * id, fetched it, and applied the same edit twice — harmless for a `replace`,
 * wrong for an array `add`. Only the writer can mint ids.
 *
 * A bridge between two systems is wired once and believed forever, which is why
 * this is tested rather than assumed.
 */
const MODULE = "/t.val.ts" as ModuleFilePath;
const TITLE = '/t.val.ts?p="title"' as SourcePath;

const module = () => {
  const { c, s } = initVal();
  return c.define("/t.val.ts", s.object({ title: s.string() }), {
    title: "Hello",
  });
};

/**
 * The engine needs a client. This one throws, so a test that accidentally takes
 * a network path fails loudly rather than reporting a suspicious success — the
 * same rule the benchmark drivers follow.
 */
const refusingClient: ValClient = async (route, method) => {
  throw new Error(
    `The mirror test took a network path it should not have: ${String(
      method,
    )} ${String(route)}`,
  );
};

const noUploadSettings = async () =>
  ({ status: "error", error: "not used in this test" }) as const;

function makeSystem(): System {
  return createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: (() => {
      let next = 0;
      return () => `mirror-${++next}` as never;
    })(),
    // The mirror seam: accept a file patch without re-uploading bytes the engine
    // already sent. Not exercised here, but present so this system is configured
    // the way `ValStoreShadow` configures it.
    uploadFile: async () => ({ status: "ok" }),
  });
}

async function setUp() {
  const { config } = initVal();
  // Writes disabled, as `ValProvider` constructs it: the store owns the `PUT`.
  const engine = new ValSyncEngine(refusingClient, undefined, undefined, true);
  const valModules: ValModules = {
    config,
    modules: [{ def: () => Promise.resolve({ default: module() }) }],
  };
  await engine.setValModules(valModules);
  const system = makeSystem();
  system.host.receive([module()]);
  return { engine, system };
}

describe("useAddPatch writes through the store", () => {
  it("moves BOTH systems, under one patch id", async () => {
    const { engine, system } = await setUp();
    let write: (() => void) | null = null;

    function Writer() {
      const { patchPath, addPatch } = useAddPatch(TITLE);
      write = () =>
        addPatch(
          [{ op: "replace", path: patchPath, value: "Changed" }],
          "string",
        );
      return null;
    }

    await act(async () => {
      render(
        <ValFieldProvider
          syncEngine={engine}
          getDirectFileUploadSettings={noUploadSettings}
          config={undefined}
        >
          <ValSystemProvider system={system}>
            <Writer />
          </ValSystemProvider>
        </ValFieldProvider>,
      );
    });

    expect(system.sourceStore.peek(TITLE)).toMatchObject({ data: "Hello" });

    await act(async () => {
      write?.();
    });

    // The engine got it, which is what every un-ported component reads.
    expect(engine.getSourceSnapshot(MODULE)).toMatchObject({
      status: "success",
      data: { title: "Changed" },
    });
    // And so did the store, which is what wrote it.
    expect(system.sourceStore.peek(TITLE)).toMatchObject({ data: "Changed" });
    // ONE id, in both. This is the assertion the flip exists for: two ids for one
    // edit is what made stat announce a patch the store did not recognise.
    const storeIds = system.patchStore.allRecords().map((r) => r.patchId);
    expect(storeIds).toHaveLength(1);
    expect(Object.keys(engine.getAllPatchesSnapshot())).toEqual(storeIds);
    system.dispose();
  });

  /**
   * With no store system there is nowhere to write, and the hook must say so
   * rather than pretend. It used to fall back to the engine; it cannot now — the
   * engine's `PUT` is disabled, so "wrote to the engine" would mean the edit was
   * applied on screen and sent nowhere, which is the worst of the three outcomes.
   */
  it("refuses the write when no store system is mounted", async () => {
    const { engine } = await setUp();
    let write: (() => void) | null = null;

    function Writer() {
      const { patchPath, addPatch } = useAddPatch(TITLE);
      write = () =>
        addPatch(
          [{ op: "replace", path: patchPath, value: "Alone" }],
          "string",
        );
      return null;
    }

    await act(async () => {
      render(
        <ValFieldProvider
          syncEngine={engine}
          getDirectFileUploadSettings={noUploadSettings}
          config={undefined}
        >
          <Writer />
        </ValFieldProvider>,
      );
    });
    await act(async () => {
      write?.();
    });

    // Unchanged: nothing applied, because nothing could be written.
    expect(engine.getSourceSnapshot(MODULE)).toMatchObject({
      status: "success",
      data: { title: "Hello" },
    });
  });

  /**
   * The engine must not `PUT`. Two writers on one linear chain is a 409 on every
   * keystroke, each "resolving" it by re-sending — so this is the assertion that
   * the second writer is really gone, not merely unused.
   *
   * `refusingClient` throws on any request, so if the engine tried to sync this
   * would surface as a rejection rather than as a silent extra write.
   */
  it("does not make the engine write", async () => {
    const { engine, system } = await setUp();
    let write: (() => void) | null = null;

    function Writer() {
      const { patchPath, addPatch } = useAddPatch(TITLE);
      write = () =>
        addPatch(
          [{ op: "replace", path: patchPath, value: "Quiet" }],
          "string",
        );
      return null;
    }

    await act(async () => {
      render(
        <ValFieldProvider
          syncEngine={engine}
          getDirectFileUploadSettings={noUploadSettings}
          config={undefined}
        >
          <ValSystemProvider system={system}>
            <Writer />
          </ValSystemProvider>
        </ValFieldProvider>,
      );
    });
    await act(async () => {
      write?.();
      // Long enough for a sync tick to have been attempted, had one been queued.
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(engine.getSourceSnapshot(MODULE)).toMatchObject({
      data: { title: "Quiet" },
    });
    // The store holds it as PENDING: this system has no write seam in the test, so
    // it recorded the patch and sent nothing. What matters is that the ENGINE did
    // not send it either — `refusingClient` would have thrown.
    expect(system.patchStore.pendingPatchIds()).toHaveLength(1);
    system.dispose();
  });
});
