/** @jest-environment jsdom */
import "../stores/react/testPolyfills";
import { act, render, screen } from "@testing-library/react";
import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import * as sharedInternal from "@valbuild/shared/internal";
import { createSystem, type System } from "../stores/createSystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { SchemaValidator } from "../validation/validateModule";
import {
  useAllValidationErrors,
  useValidationErrors,
} from "./ValErrorProvider";

/**
 * The surfaced errors are worked out once per validation event for the whole
 * Studio, and per module.
 *
 * `useAllValidationErrors` used to resolve and partition every validated
 * module's errors in each component that called it, on every validation event
 * in the project. Eight are mounted on the gallery page, and loading the posts
 * of a `.jsonValues()` record revalidates the posts module once per batch, each
 * post carrying an `image:check-gallery` marker: at 10,000 posts that was a
 * second of the load's busy time, in long tasks of up to 147 ms on a built
 * Studio (`scenarios/measure/results.md`, "The Studio, built").
 *
 * The filter is counted where it runs, through the real function: the module
 * is wrapped, not replaced.
 */
jest.mock("@valbuild/shared/internal", () => {
  const actual = jest.requireActual("@valbuild/shared/internal");
  return {
    ...actual,
    filterBlockingValidationErrors: jest.fn(
      actual.filterBlockingValidationErrors,
    ),
  };
});
const filterRuns = jest.mocked(sharedInternal.filterBlockingValidationErrors);

const PAGE = "/page.val.ts" as ModuleFilePath;
const OTHER = "/other.val.ts" as ModuleFilePath;
const PAGE_TITLE = '/page.val.ts?p="title"' as SourcePath;
const OTHER_TITLE = '/other.val.ts?p="title"' as SourcePath;

const project = () => {
  const { c, s } = initVal();
  const schema = s.object({ title: s.string().minLength(4), body: s.string() });
  return [
    // Both invalid from the start: a title that is too short.
    c.define(PAGE, schema, { title: "Hi", body: "Typed into" }),
    c.define(OTHER, schema, { title: "Yo", body: "Left alone" }),
  ];
};

function testSystem(): System {
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
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return system;
}

/** One of the eight whole-project readers on the gallery page. */
function ProjectErrors({ id }: { id: number }) {
  const errors = useAllValidationErrors();
  return (
    <span data-testid={`project-${id}`}>
      {Object.keys(errors).sort().join(",")}
    </span>
  );
}

function TitleError({ path }: { path: SourcePath }) {
  const errors = useValidationErrors(path);
  return <span data-testid={path}>{errors.length}</span>;
}

const EIGHT = [0, 1, 2, 3, 4, 5, 6, 7];

/** Every module's errors that a filter run was handed, in order. */
function modulesFiltered(): ModuleFilePath[][] {
  return filterRuns.mock.calls.map(([errors]) => [
    ...new Set(
      Object.keys(errors).map((path) => path.split("?")[0] as ModuleFilePath),
    ),
  ]);
}

describe("surfaced validation errors", () => {
  let system: System;
  beforeEach(() => {
    filterRuns.mockClear();
    system = testSystem();
  });
  afterEach(() => {
    system.dispose();
  });

  it("filters once per validation event, not once per reader", async () => {
    render(
      <ValSystemProvider system={system}>
        {EIGHT.map((id) => (
          <ProjectErrors key={id} id={id} />
        ))}
      </ValSystemProvider>,
    );
    await act(async () => {
      await system.validationStore.validate(PAGE);
    });
    filterRuns.mockClear();

    await act(async () => {
      await system.validationStore.validate(OTHER);
    });

    expect(modulesFiltered()).toEqual([[OTHER]]);
    for (const id of EIGHT) {
      expect(screen.getByTestId(`project-${id}`).textContent).toBe(
        [OTHER_TITLE, PAGE_TITLE].sort().join(","),
      );
    }
  });

  it("re-filters only the module whose result changed", async () => {
    render(
      <ValSystemProvider system={system}>
        {EIGHT.map((id) => (
          <ProjectErrors key={id} id={id} />
        ))}
      </ValSystemProvider>,
    );
    await act(async () => {
      await system.validationStore.validate(PAGE);
      await system.validationStore.validate(OTHER);
    });
    filterRuns.mockClear();

    // An edit invalidates PAGE (one event), and its revalidation is another.
    await act(async () => {
      await system.patchStore.createPatch(PAGE, [
        { op: "replace", path: ["body"], value: "Typed into, more" },
      ]);
      await system.validationStore.validate(PAGE);
    });

    expect(modulesFiltered()).toEqual([[PAGE]]);
    expect(screen.getByTestId("project-0").textContent).toBe(
      [OTHER_TITLE, PAGE_TITLE].sort().join(","),
    );
  });

  it("shares a module's answer between a field and the whole project", async () => {
    // The fields demand their modules too, so how many passes run is theirs
    // to decide; what is pinned is one filter per pass, whoever reads it.
    const results: ModuleFilePath[][] = [];
    system.validationStore.events.on("validation:result", (event) => {
      results.push([event.moduleFilePath]);
    });
    render(
      <ValSystemProvider system={system}>
        <ProjectErrors id={0} />
        <TitleError path={PAGE_TITLE} />
        <TitleError path={OTHER_TITLE} />
      </ValSystemProvider>,
    );
    await act(async () => {
      await system.validationStore.validate(PAGE);
      await system.validationStore.validate(OTHER);
    });

    expect(modulesFiltered()).toEqual(results);
    expect(screen.getByTestId(PAGE_TITLE).textContent).toBe("1");
    expect(screen.getByTestId(OTHER_TITLE).textContent).toBe("1");
  });

  it("hands every reader the same object while the answer is the same", async () => {
    await system.validationStore.validate(PAGE);
    const first = system.validationStore.surfacedErrors();
    expect(system.validationStore.surfacedErrors()).toBe(first);

    // Revalidated with the same errors: a new result, the same answer.
    await system.patchStore.createPatch(PAGE, [
      { op: "replace", path: ["body"], value: "Typed into, more" },
    ]);
    await system.validationStore.validate(PAGE);
    expect(system.validationStore.surfacedErrors()).toBe(first);
  });

  it("drops a removed module's errors", async () => {
    render(
      <ValSystemProvider system={system}>
        <ProjectErrors id={0} />
      </ValSystemProvider>,
    );
    await act(async () => {
      await system.validationStore.validate(PAGE);
      await system.validationStore.validate(OTHER);
    });
    expect(screen.getByTestId("project-0").textContent).toBe(
      [OTHER_TITLE, PAGE_TITLE].sort().join(","),
    );

    const { c, s } = initVal();
    await act(async () => {
      system.host.receive([
        c.define(
          PAGE,
          s.object({ title: s.string().minLength(4), body: s.string() }),
          { title: "Hi", body: "Typed into" },
        ),
      ]);
    });

    expect(screen.getByTestId("project-0").textContent).toBe(PAGE_TITLE);
  });

  /**
   * The hook asks for a stale module again only when that module SHOWS
   * something. Its raw answer can be all markers that resolve to nothing --
   * every post that picks an image from a gallery the build's snapshot does
   * not have it in -- and revalidating that module once per batch of a
   * `.jsonValues()` load sent the whole module to the validation worker each
   * time: at 10,000 posts the largest cost left in "used by".
   */
  it("does not ask again for a stale module that shows nothing", async () => {
    const { c, s } = initVal();
    const GALLERY = "/images.val.ts" as ModuleFilePath;
    const POST = "/post.val.ts" as ModuleFilePath;
    const PHOTO = "/public/val/images/photo.png";
    const galleryVal = c.define(GALLERY, s.imagedir("/public/val/images"), {});
    const postVal = c.define(
      POST,
      s.object({ hero: s.image(galleryVal), body: s.string() }),
      { hero: { path: PHOTO }, body: "Typed into" },
    );
    system.host.receive([galleryVal, postVal]);
    // The picked image is in the gallery now, by a pending change: the
    // build's snapshot of the gallery does not have it, so the post's
    // validation says "ask the gallery", and the gallery answers "it is here".
    await system.patchStore.createPatch(GALLERY, [
      {
        op: "add",
        path: [PHOTO],
        value: { width: 1, height: 1, mimeType: "image/png", alt: null },
      },
    ]);
    const first = await system.validationStore.validate(POST);
    expect(first.status === "validated" && first.errors).not.toBe(false);
    expect(system.validationStore.surfacedOf(first)).toEqual({});

    render(
      <ValSystemProvider system={system}>
        <ProjectErrors id={0} />
      </ValSystemProvider>,
    );
    const validate = jest.spyOn(system.validationStore, "validate");
    await act(async () => {
      await system.patchStore.createPatch(POST, [
        { op: "replace", path: ["body"], value: "Typed into, more" },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(system.validationStore.isStale(POST)).toBe(true);
    expect(validate).not.toHaveBeenCalledWith(POST);
  });
});
