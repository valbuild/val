/**
 * @jest-environment jsdom
 */
import "../stores/react/testPolyfills";
import { act, render } from "@testing-library/react";
import { initVal, type SourcePath } from "@valbuild/core";
import { createSystem, type System } from "../stores/createSystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { ValFieldProvider, useAddPatch } from "./ValFieldProvider";

/**
 * `useAddPatch` is the single choke point for field writes.
 *
 * `addPatch`, `addPatchAwaitable` and `addModuleFilePatch` all come here, so
 * everything a field can write goes through one function — which is why the
 * store system became the writer in one place rather than at twenty call sites.
 *
 * ## What this replaced
 *
 * A test of the BRIDGE between two systems: while `ValSyncEngine` still existed,
 * the store wrote and the engine followed, and the pair had to agree on patch
 * identity. They could not agree by construction — the engine merged consecutive
 * keystrokes into one patch and the store creates one per edit — so the engine
 * held one id where the store held six, and `/stat` announcing the engine's id
 * made the store fetch it and apply the same edit twice. Harmless for a
 * `replace`, wrong for an array `add`.
 *
 * That whole class of bug is gone with the second system. What is left is the
 * part that was never about the bridge: one edit is one patch, and a write with
 * nowhere to go is refused rather than pretended.
 */
const TITLE = '/t.val.ts?p="title"' as SourcePath;

const module = () => {
  const { c, s } = initVal();
  return c.define("/t.val.ts", s.object({ title: s.string() }), {
    title: "Hello",
  });
};

const noUploadSettings = async () =>
  ({ status: "error", error: "not used in this test" }) as const;

function makeSystem(): System {
  return createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: (() => {
      let next = 0;
      return () => `write-${++next}` as never;
    })(),
    uploadFile: async () => ({ status: "ok" }),
  });
}

function setUp(): System {
  const system = makeSystem();
  system.host.receive([module()]);
  return system;
}

describe("useAddPatch", () => {
  it("moves the value, under exactly one patch id", async () => {
    const system = setUp();
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

    expect(system.sourceStore.peek(TITLE)).toMatchObject({ data: "Changed" });
    // ONE patch for one edit. The server keeps a single linear chain and checks
    // every `parentRef`, so a second id for the same edit is a 409 waiting to
    // happen — and was, for as long as two systems both minted them.
    expect(system.patchStore.allRecords()).toHaveLength(1);
    system.dispose();
  });

  /**
   * Rendered with no system — a story, a preview, a host page with no Val — an
   * edit has nowhere to go, and the hook has to say so.
   *
   * Reported rather than dropped, and rather than applied locally: an edit that
   * appears on screen and reaches no server is the worst of the three outcomes,
   * because the user has no way to tell it apart from one that worked.
   */
  it("refuses the write when no store system is mounted", async () => {
    const errors: unknown[] = [];
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation((...args) => {
        errors.push(args);
      });
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

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("no store system is mounted");
    consoleError.mockRestore();
  });
});
