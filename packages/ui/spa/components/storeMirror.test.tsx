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
 * The engine → store mirror, which is what makes an incremental port possible.
 *
 * The shadow store system never writes to the server, but it has to SEE local
 * edits: the instant someone types, its source would otherwise drift from what is
 * on screen, and a component ported to read from it would show a stale value. So
 * `useAddPatch` — the single choke point for field writes — feeds every patch into
 * the store's patch chain as well as the engine's.
 *
 * That is a bridge between two systems, which is exactly the kind of thing that
 * is wired once, believed forever, and quietly stops working. Hence a test.
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
  const engine = new ValSyncEngine(refusingClient, undefined, undefined);
  const valModules: ValModules = {
    config,
    modules: [{ def: () => Promise.resolve({ default: module() }) }],
  };
  await engine.setValModules(valModules);
  const system = makeSystem();
  system.host.receive([module()]);
  return { engine, system };
}

describe("useAddPatch mirrors into the store system", () => {
  it("moves the store's source, not only the engine's", async () => {
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

    // The engine got it, which is the behaviour that ships.
    expect(engine.getSourceSnapshot(MODULE)).toMatchObject({
      status: "success",
      data: { title: "Changed" },
    });
    // And so did the store, which is what lets a component read from it without
    // going stale the moment anyone types.
    expect(system.sourceStore.peek(TITLE)).toMatchObject({ data: "Changed" });
    system.dispose();
  });

  /**
   * With no provider the hook must still write to the engine. `useValSystem`
   * returns null outside a provider, and every consumer has to handle that —
   * a mirror that made itself required would break every context where the
   * Studio renders without one.
   */
  it("writes to the engine when no store system is mounted", async () => {
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

    expect(engine.getSourceSnapshot(MODULE)).toMatchObject({
      status: "success",
      data: { title: "Alone" },
    });
  });
});
