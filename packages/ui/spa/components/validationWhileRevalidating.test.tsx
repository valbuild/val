/** @jest-environment jsdom */
import "../stores/react/testPolyfills";
import { act, render, screen } from "@testing-library/react";
import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { type ReactNode } from "react";
import { createSystem, type System } from "../stores/createSystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { SchemaValidator } from "../validation/validateModule";
import {
  useAllValidationErrors,
  useValidationErrors,
} from "./ValErrorProvider";

/**
 * An error stays on screen while the module it is in revalidates.
 *
 * Every edit makes its module stale, and stale used to be drawn as "no
 * errors". So with an error ANYWHERE in the module being typed into, the error
 * left the screen for the length of every revalidation and came back: the
 * Publish button went "Fix 1" → "Publish" → "Fix 1" once per pause in typing,
 * and the message under an invalid field blinked out and in, moving
 * everything below it twice. Measured in the Studio at about 40 flips in ten
 * seconds of typing, which is how it was reported — as blinking.
 *
 * Pinned with validation HELD open, because that window is the whole bug: the
 * flash lasted exactly as long as the revalidation did, and a test whose
 * validation finishes before it looks would see nothing either way.
 */

const PAGE = "/page.val.ts" as ModuleFilePath;
const TITLE = '/page.val.ts?p="title"' as SourcePath;

const project = () => {
  const { c, s } = initVal();
  return [
    c.define(
      PAGE,
      s.object({ title: s.string().minLength(4), body: s.string() }),
      // Invalid from the start: a title that is too short.
      { title: "Hi", body: "Typed into" },
    ),
  ];
};

/** A system whose validation can be held open, so the stale window is visible. */
function gatedSystem() {
  const validator = new SchemaValidator();
  let release: () => void = () => {};
  let gate: Promise<void> = Promise.resolve();
  const system: System = createSystem({
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
    // Never fires on its own: the test decides when revalidation runs.
    deferPendingValidation: () => () => {},
    schemaValidation: {
      async validate(moduleFilePath, source, serializedSchema, version) {
        await gate;
        return validator.validate(
          moduleFilePath,
          source,
          serializedSchema,
          version,
        );
      },
    },
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return {
    system,
    hold() {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    async release() {
      release();
      // Let the validation that was waiting finish and announce itself.
      await act(async () => {
        await system.validationStore.validate(PAGE);
      });
    },
  };
}

function Harness({
  system,
  children,
}: {
  system: System;
  children: ReactNode;
}) {
  return <ValSystemProvider system={system}>{children}</ValSystemProvider>;
}

/** What the Publish button counts. */
function ProjectErrors() {
  const errors = useAllValidationErrors();
  return <span data-testid="project">{Object.keys(errors).join(",")}</span>;
}

/** What the title field shows under itself. */
function TitleErrors() {
  const errors = useValidationErrors(TITLE);
  return <span data-testid="title">{errors.length}</span>;
}

async function edit(system: System, path: string[], value: string) {
  await act(async () => {
    await system.patchStore.createPatch(PAGE, [{ op: "replace", path, value }]);
  });
}

describe("validation errors while their module revalidates", () => {
  it("keeps the last result readable once an edit makes it stale", async () => {
    const { system } = gatedSystem();
    const before = await system.validationStore.validate(PAGE);
    expect(before.status).toBe("validated");

    await system.patchStore.createPatch(PAGE, [
      { op: "replace", path: ["body"], value: "Typed into, more" },
    ]);

    // Still stale to anything that DECIDES — that is what asks for a new pass.
    expect(system.validationStore.peek(PAGE).status).toBe("stale");
    expect(system.validationStore.isStale(PAGE)).toBe(true);
    // And the same answer as before to anything that only shows it.
    expect(system.validationStore.peekLastKnown(PAGE)).toBe(before);

    const after = await system.validationStore.validate(PAGE);
    expect(system.validationStore.peekLastKnown(PAGE)).toBe(after);
    expect(system.validationStore.isStale(PAGE)).toBe(false);
    system.dispose();
  });

  it("knows nothing about a module that was never validated", () => {
    const { system } = gatedSystem();
    expect(system.validationStore.peekLastKnown(PAGE).status).toBe("stale");
    system.dispose();
  });

  it("does not drop a project-wide error while the module revalidates", async () => {
    const { system, hold, release } = gatedSystem();
    render(
      <Harness system={system}>
        <ProjectErrors />
      </Harness>,
    );
    await act(async () => {
      await system.validationStore.validate(PAGE);
    });
    expect(screen.getByTestId("project").textContent).toBe(TITLE);

    // Typing into ANOTHER field of the same module: the title is still wrong.
    hold();
    await edit(system, ["body"], "Typed into, more");
    expect(screen.getByTestId("project").textContent).toBe(TITLE);

    await release();
    expect(screen.getByTestId("project").textContent).toBe(TITLE);
    system.dispose();
  });

  it("does not drop a field's own error while the module revalidates", async () => {
    const { system, hold, release } = gatedSystem();
    render(
      <Harness system={system}>
        <TitleErrors />
      </Harness>,
    );
    await act(async () => {
      await system.validationStore.validate(PAGE);
    });
    expect(screen.getByTestId("title").textContent).toBe("1");

    hold();
    await edit(system, ["body"], "Typed into, more");
    expect(screen.getByTestId("title").textContent).toBe("1");

    await release();
    expect(screen.getByTestId("title").textContent).toBe("1");
    system.dispose();
  });

  /**
   * The other half: holding on to an answer must not mean holding on to it
   * for good. A fixed error goes once the pass that saw the fix lands — and
   * the project-wide hook asks for that pass itself, rather than waiting for a
   * field in the module to be on screen, or a fixed error would sit on the
   * Publish button indefinitely.
   */
  it("lets a fixed error go once the module has been revalidated", async () => {
    const { system } = gatedSystem();
    render(
      <Harness system={system}>
        <ProjectErrors />
      </Harness>,
    );
    await act(async () => {
      await system.validationStore.validate(PAGE);
    });
    expect(screen.getByTestId("project").textContent).toBe(TITLE);

    // No field is mounted and the pending-validation pass never fires here,
    // so only the hook's own demand can revalidate.
    await edit(system, ["title"], "Long enough");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId("project").textContent).toBe("");
    system.dispose();
  });

  it("does not ask to revalidate a module whose last answer was clean", async () => {
    const { system } = gatedSystem();
    await system.patchStore.createPatch(PAGE, [
      { op: "replace", path: ["title"], value: "Long enough" },
    ]);
    await system.validationStore.validate(PAGE);
    render(
      <Harness system={system}>
        <ProjectErrors />
      </Harness>,
    );
    const validate = jest.spyOn(system.validationStore, "validate");
    await edit(system, ["body"], "Typed into, more");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(validate).not.toHaveBeenCalled();
    expect(system.validationStore.isStale(PAGE)).toBe(true);
    system.dispose();
  });
});
