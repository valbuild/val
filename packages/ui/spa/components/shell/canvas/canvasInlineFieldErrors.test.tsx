/** @jest-environment jsdom */
import "../../../stores/react/testPolyfills";
import { act, render, screen } from "@testing-library/react";
import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { createSystem, type System } from "../../../stores/createSystem";
import { ValSystemProvider } from "../../../stores/react/SystemContext";
import { writePatch } from "../../../stores/react/writePatch";
import { SchemaValidator } from "../../../validation/validateModule";
import { CanvasInlineEditFloat } from "./CanvasInlineFieldErrors";
import { inlineEditPatch } from "./useCanvasInlineEdit";
import {
  INLINE_TOOLBAR_ATTRIBUTE,
  type InlineEditLocation,
} from "./placeInlineToolbar";

/**
 * A field's validation errors, by the text being typed in on the page: the
 * errors its row in the column shows, as they change, and nothing at all
 * for a string with nothing wrong with it.
 */

const PAGE = "/page.val.ts" as ModuleFilePath;
const TITLE = '/page.val.ts?p="title"' as SourcePath;

function testSystem(): System {
  const { c, s } = initVal();
  const validator = new SchemaValidator();
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
    schemaValidation: {
      async validate(moduleFilePath, source, serializedSchema, version) {
        return validator.validate(
          moduleFilePath,
          source,
          serializedSchema,
          version,
        );
      },
    },
  });
  system.host.receive([
    c.define(
      PAGE,
      s.object({
        title: s
          .string()
          .regexp(/^\S.*\S$/, "No leading or trailing whitespace"),
      }),
      { title: "Our people" },
    ),
  ]);
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return system;
}

/** The text on the page, in the Studio's viewport. */
const location: InlineEditLocation = {
  field: { top: 300, left: 400, width: 500, height: 60 },
  caret: null,
  clip: { top: 100, left: 300, width: 800, height: 600 },
};

/** Typed on the page: written as an edit on the page writes it. */
async function type(system: System, value: string) {
  const patch = inlineEditPatch({ path: TITLE, kind: "string" }, value);
  if (patch === null) throw new Error("not a string's patch");
  await act(async () => {
    await writePatch(system, PAGE, patch);
    await system.validationStore.validate(PAGE);
  });
}

describe("a field's validation errors, by the text on the page", () => {
  it("come and go with the field's own, and draw nothing while there are none", async () => {
    const system = testSystem();
    render(
      <ValSystemProvider system={system}>
        <CanvasInlineEditFloat
          path={TITLE}
          locate={() => location}
          toolbar={null}
        />
      </ValSystemProvider>,
    );
    await act(async () => {
      await system.validationStore.validate(PAGE);
    });
    expect(
      screen.queryByLabelText("Validation errors for the text on the page"),
    ).toBeNull();

    await type(system, "Our people ");
    const errors = screen.getByLabelText(
      "Validation errors for the text on the page",
    );
    expect(errors.textContent).toContain("No leading or trailing whitespace");
    // A press on the message is not a press elsewhere: the edit goes on.
    expect(errors.closest(`[${INLINE_TOOLBAR_ATTRIBUTE}]`)).not.toBeNull();

    await type(system, "Our people");
    expect(
      screen.queryByLabelText("Validation errors for the text on the page"),
    ).toBeNull();
    system.dispose();
  });

  it("are shown with the controls of a richtext, in the same box", async () => {
    const system = testSystem();
    await type(system, " Our people");
    render(
      <ValSystemProvider system={system}>
        <CanvasInlineEditFloat
          path={TITLE}
          locate={() => location}
          toolbar={<div role="toolbar" aria-label="Format" />}
        />
      </ValSystemProvider>,
    );
    await act(async () => {
      await system.validationStore.validate(PAGE);
    });
    const bar = screen.getByRole("toolbar", { name: "Format" });
    const errors = screen.getByLabelText(
      "Validation errors for the text on the page",
    );
    expect(bar.parentElement?.contains(errors)).toBe(true);
    system.dispose();
  });
});
