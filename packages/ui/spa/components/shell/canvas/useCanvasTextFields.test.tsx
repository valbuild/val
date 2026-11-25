/** @jest-environment jsdom */
import "../../../stores/react/testPolyfills";
import { act, render } from "@testing-library/react";
import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { createSystem, type System } from "../../../stores/createSystem";
import { ValSystemProvider } from "../../../stores/react/SystemContext";
import { writePatch } from "../../../stores/react/writePatch";
import type { CanvasTextFields } from "./canvasTextFields";
import { inlineEditPatch } from "./useCanvasInlineEdit";
import { useCanvasTextFields } from "./useCanvasTextFields";

/**
 * What the page is told of its texts is read in the shell, so its reader is
 * the whole Studio: it may render for a field write only when what the page
 * is told is different (`docs/plans/studio-write-lag.md`).
 */

const PAGE = "/page.val.ts" as ModuleFilePath;
const TITLE = '/page.val.ts?p="title"' as SourcePath;
const TAGLINE = '/page.val.ts?p="tagline"' as SourcePath;
const PATHS: readonly SourcePath[] = [TITLE, TAGLINE];

function testSystem(): System {
  const { c, s } = initVal();
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: (() => {
      let next = 0;
      return (): PatchId => `p${++next}` as PatchId;
    })(),
    savePatches: async ({ patches, parentRef }) => ({
      status: "saved",
      newPatchIds: patches.map((patch) => patch.patchId),
      parentRef,
    }),
    publishPatches: async () => ({ status: "published" }),
    discardPatches: async (patchIds) => ({ status: "discarded", patchIds }),
    deferPendingValidation: () => () => {},
  });
  system.host.receive([
    c.define(PAGE, s.object({ title: s.string(), tagline: s.string() }), {
      title: "Our people",
      tagline: "",
    }),
  ]);
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return system;
}

/** Typed in a field: written as an edit on the page writes it. */
async function type(system: System, path: SourcePath, value: string) {
  const patch = inlineEditPatch({ path, kind: "string" }, value);
  if (patch === null) throw new Error("not a string's patch");
  await act(async () => {
    await writePatch(system, PAGE, patch);
  });
}

/** A reader of the hook, and every answer it was rendered with. */
function renderReader(system: System, editing: boolean) {
  const answers: CanvasTextFields[] = [];
  function Reader() {
    answers.push(useCanvasTextFields(PATHS, editing));
    return null;
  }
  render(
    <ValSystemProvider system={system}>
      <Reader />
    </ValSystemProvider>,
  );
  return answers;
}

describe("what the page is told of its texts", () => {
  it("does not render its reader for a write that changes none of it", async () => {
    const system = testSystem();
    const answers = renderReader(system, false);
    const told = answers[answers.length - 1];
    expect(told).toEqual({ editing: false, editable: [], empty: [TAGLINE] });
    const renders = answers.length;

    await type(system, TITLE, "Our people, and yours");

    expect(answers.length).toBe(renders);
    system.dispose();
  });

  it("is told again when a text is emptied, as of that write", async () => {
    const system = testSystem();
    const answers = renderReader(system, false);

    await type(system, TITLE, "");

    expect(answers[answers.length - 1].empty).toEqual([TITLE, TAGLINE]);

    await type(system, TAGLINE, "And yours");

    expect(answers[answers.length - 1].empty).toEqual([TITLE]);
    system.dispose();
  });

  it("holds what each text holds in Select & edit, as of the last write", async () => {
    const system = testSystem();
    const answers = renderReader(system, true);

    await type(system, TITLE, "Our people, and yours");

    const told = answers[answers.length - 1];
    expect(told.editing).toBe(true);
    expect(told.editable).toEqual([
      { path: TITLE, kind: "string", value: "Our people, and yours" },
      { path: TAGLINE, kind: "string", value: "" },
    ]);
    system.dispose();
  });
});
