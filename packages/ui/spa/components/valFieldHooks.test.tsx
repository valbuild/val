/**
 * @jest-environment jsdom
 */
// FIRST, and it must stay first: the store layer builds a `TextEncoder` at module
// scope, so the polyfills have to be installed before those modules evaluate.
import "../stores/react/testPolyfills";
import { act, render, screen } from "@testing-library/react";
import {
  initVal,
  Internal,
  type ModuleFilePath,
  type SourcePath,
} from "@valbuild/core";
import React, { useRef, type ReactNode } from "react";
import { createSystem, type System } from "../stores/createSystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import {
  useAddPatch,
  useFieldCreatorId,
  useHasUnsavedFrom,
  useLoadingStatus,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useSourceAtPath,
} from "./ValFieldProvider";
import { useValidationErrors } from "./ValErrorProvider";
import { ImageField } from "./fields/ImageField";
import { FileField } from "./fields/FileField";
import { ValFieldProvider } from "./ValFieldProvider";
import { ValRemoteProvider } from "./ValRemoteProvider";
import { ValPortalProvider } from "./ValPortalProvider";
import { ValThemeProvider } from "./ValThemeProvider";

/**
 * The field components reach `createValSystem`, which reaches the validation
 * worker bridge, which is `new Worker(new URL(..., import.meta.url))` — syntax
 * jest cannot parse. Mocked at the seam rather than not testing these
 * components: nothing under test here validates anything.
 */
jest.mock("../validation/schemaValidationBridge", () => ({
  createSchemaValidationBridge: () => ({
    validate: async () => ({ errors: false }),
    dispose: () => {},
  }),
}));

/**
 * The hooks a field actually renders through, tested against a real system.
 *
 * ## Why these are worth testing separately from the stores
 *
 * The store layer's value is unrealised until a component can read it, and the
 * two claims that matter most are about RENDER COUNTS rather than values: a
 * mounting field must paint once, and a keystroke must not wake the fields it did
 * not touch. Neither is visible without React in the loop — `bench/` measures them
 * but cannot assert them, and every store-level test passes whether or not the
 * hook wired to it re-renders the world.
 *
 * A real system, not a mock: these hooks' only job is to route between React and
 * the stores, so a mocked store would leave nothing under test.
 *
 * ## Why `ValFieldProvider` and not the layer under it
 *
 * These assertions used to drive `stores/react/`'s own copies of the same hooks,
 * written as a parallel layer so components could be moved across one at a time
 * while `ValSyncEngine` still existed. `ValFieldProvider` is built on the stores
 * now, so those copies had no callers and the tests pinned behaviour nothing
 * rendered. Pointed here they cover the path the Studio takes.
 */
const project = () => {
  const { c, s } = initVal();
  return [
    c.define(
      "/page.val.ts",
      s.object({ title: s.string(), body: s.string() }),
      {
        title: "Hello",
        body: "World",
      },
    ),
    c.define("/other.val.ts", s.object({ title: s.string() }), {
      title: "Elsewhere",
    }),
  ];
};

function makeSystem(): System {
  return createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: (() => {
      let next = 0;
      return () => `hook-${++next}` as never;
    })(),
  });
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

/** A read-only field that reports how many times it rendered, in its own body. */
function Field({
  path,
  renders,
}: {
  path: string;
  renders: { current: number };
}) {
  renders.current++;
  const source = useSourceAtPath(path as SourcePath);
  return (
    <span data-testid={path}>
      {source.status === "success" ? String(source.data) : source.status}
    </span>
  );
}

describe("useSourceAtPath", () => {
  it("paints the value on the FIRST render, not the second", () => {
    const system = makeSystem();
    system.host.receive(project());
    const renders = { current: 0 };

    render(
      <Harness system={system}>
        <Field path='/page.val.ts?p="title"' renders={renders} />
      </Harness>,
    );

    // ONE render, with the value already in it. This is the whole reason `peek`
    // carries the value: an async read painted `loading` first and the value a
    // microtask later, which measured as 32 mount renders against the engine's
    // 16 in `bench/`.
    expect(screen.getByTestId('/page.val.ts?p="title"').textContent).toBe(
      "Hello",
    );
    expect(renders.current).toBe(1);
    system.dispose();
  });

  it("re-renders only the field whose own path moved", async () => {
    const system = makeSystem();
    system.host.receive(project());
    const title = { current: 0 };
    const body = { current: 0 };
    const elsewhere = { current: 0 };

    render(
      <Harness system={system}>
        <Field path='/page.val.ts?p="title"' renders={title} />
        <Field path='/page.val.ts?p="body"' renders={body} />
        <Field path='/other.val.ts?p="title"' renders={elsewhere} />
      </Harness>,
    );
    const before = {
      title: title.current,
      body: body.current,
      elsewhere: elsewhere.current,
    };

    await act(async () => {
      // No `fieldId`, so nothing is suppressed: this stands for an edit made
      // somewhere other than these three fields.
      await system.patchStore.createPatch("/page.val.ts" as ModuleFilePath, [
        { op: "replace", path: ["title"], value: "Changed" },
      ]);
    });

    expect(screen.getByTestId('/page.val.ts?p="title"').textContent).toBe(
      "Changed",
    );
    expect(title.current).toBe(before.title + 1);
    // THE claim this layer exists for. The engine's finest source subscription
    // was per MODULE, so `body` — a sibling in the edited module — re-rendered
    // too: measured at 16 of 16 fields per keystroke. Here it does not.
    expect(body.current).toBe(before.body);
    expect(elsewhere.current).toBe(before.elsewhere);
    system.dispose();
  });

  it("renders loading for a module that has not arrived", () => {
    const system = makeSystem();
    const renders = { current: 0 };

    render(
      <Harness system={system}>
        <Field path='/page.val.ts?p="title"' renders={renders} />
      </Harness>,
    );

    expect(screen.getByTestId('/page.val.ts?p="title"').textContent).toBe(
      "loading",
    );
    system.dispose();
  });

  it("paints once when the module arrives after mount", async () => {
    const system = makeSystem();
    const renders = { current: 0 };

    render(
      <Harness system={system}>
        <Field path='/page.val.ts?p="title"' renders={renders} />
      </Harness>,
    );
    const beforeIntake = renders.current;

    await act(async () => {
      system.host.receive(project());
    });

    expect(screen.getByTestId('/page.val.ts?p="title"').textContent).toBe(
      "Hello",
    );
    // One further render for the value arriving, not two.
    expect(renders.current).toBe(beforeIntake + 1);
    system.dispose();
  });
});

/**
 * A field that reads and writes under ONE id, the way every real field does:
 * `useFieldCreatorId()` once, handed to both hooks.
 *
 * That is the convention suppression depends on — the store compares the id that
 * registered the listener with the id that created the patch — and it is why the
 * id is a parameter of both hooks rather than something each derives for itself.
 */
function TypingField({
  renders,
  onReady,
  readerId,
}: {
  renders?: { current: number };
  onReady: (write: (value: string) => Promise<unknown>) => void;
  /** Override the READ id, to show what happens when the two differ. */
  readerId?: string;
}) {
  if (renders) renders.current++;
  const creatorId = useFieldCreatorId();
  const source = useShallowSourceAtPath(
    '/page.val.ts?p="title"' as SourcePath,
    "string",
    readerId ?? creatorId,
  );
  const { patchPath, addPatch } = useAddPatch(
    '/page.val.ts?p="title"' as SourcePath,
    creatorId,
  );
  // Held in a ref so driving the write from the test does not depend on the
  // closure identity, which changes on every render.
  const held = useRef(addPatch);
  held.current = addPatch;
  onReady(async (value: string) => {
    held.current([{ op: "replace", path: patchPath, value }], "string");
    // `addPatch` is fire-and-forget by design — a keystroke must not await a
    // network-shaped call before the character appears — so the test waits for
    // the microtask in which the store records the patch.
    await Promise.resolve();
  });
  return (
    <span data-testid="typing">
      {source.status === "success" ? String(source.data) : source.status}
    </span>
  );
}

describe("per-instance suppression", () => {
  it("leaves the field that made the edit asleep", async () => {
    const system = makeSystem();
    system.host.receive(project());
    const renders = { current: 0 };
    let write: ((value: string) => Promise<unknown>) | null = null;

    render(
      <Harness system={system}>
        <TypingField
          renders={renders}
          onReady={(fn) => {
            write = fn;
          }}
        />
      </Harness>,
    );
    const before = renders.current;

    await act(async () => {
      await write?.("typed");
    });

    // Not woken: the same id read and wrote, so the store left this instance
    // alone. A field interrupted by its own keystroke loses the cursor, which is
    // the bug per-instance suppression exists to prevent.
    expect(renders.current).toBe(before);
    system.dispose();
  });

  it("wakes a second instance on the same path", async () => {
    const system = makeSystem();
    system.host.receive(project());
    const overlay = { current: 0 };
    let write: ((value: string) => Promise<unknown>) | null = null;

    render(
      <Harness system={system}>
        <TypingField
          onReady={(fn) => {
            write = fn;
          }}
        />
        <Field path='/page.val.ts?p="title"' renders={overlay} />
      </Harness>,
    );
    const before = overlay.current;

    await act(async () => {
      await write?.("typed");
    });

    // Suppression is per INSTANCE, so the studio field typing does not silence
    // the inline overlay showing the same path. A distinct id per hook call is
    // what makes these two listeners rather than one.
    expect(overlay.current).toBe(before + 1);
    expect(screen.getByTestId('/page.val.ts?p="title"').textContent).toBe(
      "typed",
    );
    system.dispose();
  });

  /**
   * The trap, asserted so nobody "simplifies" the shared id away.
   *
   * Reading under one id and writing under another is not a subtle inefficiency
   * — the field is woken by its own keystroke, which in a real text input means
   * the cursor jumps. Every field passes one `useFieldCreatorId()` to both hooks;
   * this is what it buys.
   */
  it("IS woken by its own edit when the read and write ids differ", async () => {
    const system = makeSystem();
    system.host.receive(project());
    const renders = { current: 0 };
    let write: ((value: string) => Promise<unknown>) | null = null;

    render(
      <Harness system={system}>
        <TypingField
          renders={renders}
          readerId="a-different-instance"
          onReady={(fn) => {
            write = fn;
          }}
        />
      </Harness>,
    );
    const before = renders.current;

    await act(async () => {
      await write?.("typed");
    });

    expect(renders.current).toBe(before + 1);
    system.dispose();
  });
});

describe("useSchemaAtPath", () => {
  it("hands back the schema at the path once intake has run", async () => {
    const system = makeSystem();
    let seen: unknown = null;

    function SchemaReader() {
      seen = useSchemaAtPath('/page.val.ts?p="title"' as SourcePath);
      return null;
    }
    render(
      <Harness system={system}>
        <SchemaReader />
      </Harness>,
    );
    expect(seen).toMatchObject({ status: "loading" });

    await act(async () => {
      system.host.receive(project());
    });

    // Resolved AT the path — `string`, not the module's `object`. That walk is
    // what a field needs in order to know which editor to render.
    expect(seen).toMatchObject({ status: "success", data: { type: "string" } });
    system.dispose();
  });
});

describe("useLoadingStatus", () => {
  /**
   * An unsaved edit is not `success`.
   *
   * `patchSync.test.ts` pins the store-level claim — a system with no write seam
   * reports `pending` forever rather than pretending. This is the half that
   * cannot be seen from there: that the status a component renders actually
   * moves when it does. An edit reporting itself saved while nothing left the tab
   * is the worst outcome available.
   */
  it("reports an unsaved edit as loading", async () => {
    const system = makeSystem();
    system.host.receive(project());
    system.stat.receiveStat({ patches: [], baseSha: "sha" });
    const box: { seen: string | null } = { seen: null };

    function StatusReader() {
      box.seen = useLoadingStatus();
      return null;
    }
    render(
      <Harness system={system}>
        <StatusReader />
      </Harness>,
    );
    expect(box.seen).toBe("success");

    await act(async () => {
      await system.patchStore.createPatch("/page.val.ts" as ModuleFilePath, [
        { op: "replace", path: ["title"], value: "unsaved" },
      ]);
      await system.patchSync.flush();
    });

    expect(box.seen).toBe("loading");
    system.dispose();
  });
});

/**
 * A router record with a `s.route()` field, which is the shape that exposed the
 * bug: `RouteSchema` emits `router:check-route` for EVERY route field,
 * unconditionally, and something with the whole project in hand has to resolve it
 * into a real error or nothing.
 */
const routerProject = () => {
  const { c, s } = initVal();
  return [
    c.define(
      "/app/pages/[[...path]]/page.val.ts",
      s.router(
        Internal.nextAppRouter,
        s.object({ url: s.route(), title: s.string() }),
      ),
      {
        "/pages/one": { url: "/pages/one", title: "One" },
      },
    ),
  ];
};

function RouteErrors({ path }: { path: string }) {
  const errors = useValidationErrors(path as SourcePath);
  return (
    <span data-testid="errors">
      {errors.length === 0 ? "none" : errors.map((e) => e.message).join(" | ")}
    </span>
  );
}

describe("useValidationErrors", () => {
  /**
   * GUARD: a route field never shows the raw cross-module marker.
   *
   * The engine resolved these before any consumer saw them — its per-path
   * snapshot read through the resolved whole-project map — and the store port
   * returned `result.errors[path]` raw instead. The visible consequence is worse
   * than the ugly text: nothing in the raw map ever asks whether the route is
   * valid, so a route error could not clear when the route was set. Setting it
   * fixed the content and the field went on complaining until a reload.
   */
  it("resolves router:check-route instead of showing it raw", async () => {
    const system = makeSystem();
    system.host.receive(routerProject());

    render(
      <Harness system={system}>
        <RouteErrors path='/app/pages/[[...path]]/page.val.ts?p="/pages/one"."url"' />
      </Harness>,
    );

    // Validation is demand-driven, so the first paint has nothing yet. Wait for
    // the result rather than sleeping.
    await act(async () => {
      await system.validationStore.validate(
        "/app/pages/[[...path]]/page.val.ts" as ModuleFilePath,
      );
    });

    const shown = screen.getByTestId("errors").textContent ?? "";
    // The marker's own words. Asserted on the TEXT rather than on the count,
    // because "no errors at all" is not the claim — the claim is that whatever
    // reaches a field has been through the resolver.
    expect(shown).not.toMatch(
      /should typically be processed by Val internally/,
    );
    expect(shown).not.toMatch(/version mismatch/);
    system.dispose();
  });
});

/**
 * `clientSideOnly` — "do I have an edit the server has not acknowledged" — has to
 * track the PATCH CHAIN, not source.
 *
 * The two move independently: saving a patch changes its durability, not its
 * value, so nothing emits `source:change`. This was computed inside
 * `useShallowSourceAtPath`'s memo, whose inputs are all source-shaped, so it kept
 * whatever answer it had at the moment of the edit until something unrelated moved
 * source at that path.
 *
 * What that cost, in the real Studio: `ArrayFields` fed it to `disabled`, and an
 * array row's drag handle is a `<button disabled>`. So one drag on
 * `/content/handbook.val.ts` disabled dragging and left a spinner up — measured as
 * still stuck 8 seconds later, and cleared instantly by an unrelated edit, which
 * is the signature of a stale memo rather than of work still in flight.
 */
describe("clientSideOnly", () => {
  /** The most recent value, without `Array.prototype.at` (not in this lib target). */
  const last = (values: (boolean | null)[]) => values[values.length - 1];

  function Watcher({
    path,
    creatorId,
    seen,
  }: {
    path: string;
    creatorId: string;
    seen: { current: (boolean | null)[] };
  }) {
    const source = useShallowSourceAtPath(
      path as SourcePath,
      "string",
      creatorId,
    );
    seen.current.push(
      source.status === "success" ? (source.clientSideOnly ?? false) : null,
    );
    return <span data-testid="watch">{String(source.status)}</span>;
  }

  it("is not frozen at the answer it had when the edit was made", async () => {
    const system = makeSystem();
    system.host.receive(project());
    const seen: { current: (boolean | null)[] } = { current: [] };
    const creatorId = "the-field-instance";
    // A FRESH element each time: `rerender` with the same element reference lets
    // React skip the subtree, so the probe would never run again.
    const view = () => (
      <Harness system={system}>
        <Watcher
          path='/page.val.ts?p="title"'
          creatorId={creatorId}
          seen={seen}
        />
      </Harness>
    );

    const { rerender } = render(view());
    expect(last(seen.current)).toBe(false);

    await act(async () => {
      await system.patchStore.createPatch(
        "/page.val.ts" as ModuleFilePath,
        [{ op: "replace", path: ["title"], value: "mine" }],
        undefined,
        creatorId,
      );
    });
    // Rerendered to observe it at all: this field is not woken by its own edit,
    // so without a render from elsewhere it never shows the change. That is the
    // suppression the test below guards, and it is why this value has to be
    // correct on demand rather than pushed.
    await act(async () => {
      rerender(view());
    });
    expect(last(seen.current)).toBe(true);

    // The acknowledgement, and nothing else: no patch and no source change,
    // which is the whole difficulty — the chain moved and source did not.
    await act(async () => {
      const pending = system.patchStore.pendingPatchIds();
      expect(pending).toHaveLength(1);
      system.patchStore.markSaved(pending);
    });

    // A render this field would have had anyway. It is not woken by the save —
    // that is per-instance suppression and a text field depends on it — so the
    // claim is that WHEN it renders, the answer is current. Before the fix this
    // stayed `true`: the value was computed inside a memo keyed on the source
    // read, so nothing short of a source change at this path could refresh it.
    await act(async () => {
      rerender(view());
    });

    expect(last(seen.current)).toBe(false);
    system.dispose();
  });

  it("does not wake the field that made the edit when it is acknowledged", async () => {
    const system = makeSystem();
    system.host.receive(project());
    const seen: { current: (boolean | null)[] } = { current: [] };
    const creatorId = "the-field-instance";

    render(
      <Harness system={system}>
        <Watcher
          path='/page.val.ts?p="title"'
          creatorId={creatorId}
          seen={seen}
        />
      </Harness>,
    );
    await act(async () => {
      await system.patchStore.createPatch(
        "/page.val.ts" as ModuleFilePath,
        [{ op: "replace", path: ["title"], value: "mine" }],
        undefined,
        creatorId,
      );
    });

    const rendersBefore = seen.current.length;
    await act(async () => {
      system.patchStore.markSaved(system.patchStore.pendingPatchIds());
    });

    // The other half of the pair above, and the reason this is a plain read
    // rather than a subscription: a controlled input re-rendered by the
    // acknowledgement of its own keystroke loses the caret.
    expect(seen.current.length).toBe(rendersBefore);
    system.dispose();
  });

  /**
   * And it stays false for someone else's edit, so the fix did not turn this into
   * "is anything unsaved anywhere".
   */
  it("ignores an unsaved edit made by another field", async () => {
    const system = makeSystem();
    system.host.receive(project());
    const seen: { current: (boolean | null)[] } = { current: [] };

    render(
      <Harness system={system}>
        <Watcher path='/page.val.ts?p="title"' creatorId="mine" seen={seen} />
      </Harness>,
    );

    await act(async () => {
      await system.patchStore.createPatch(
        "/page.val.ts" as ModuleFilePath,
        [{ op: "replace", path: ["title"], value: "theirs" }],
        undefined,
        "someone-else",
      );
    });

    expect(last(seen.current)).toBe(false);
    system.dispose();
  });
});

/**
 * `useHasUnsavedFrom` — the same fact, subscribed.
 *
 * For a consumer with no caret to lose and a visible indicator, where the value
 * being merely correct-when-rendered is not enough: an array field's "saving"
 * hint stuck on after the save had landed is what sent me here.
 */
describe("useHasUnsavedFrom", () => {
  function Probe({
    creatorId,
    seen,
  }: {
    creatorId: string;
    seen: { current: boolean[] };
  }) {
    const unsaved = useHasUnsavedFrom(
      "/page.val.ts" as ModuleFilePath,
      creatorId,
    );
    seen.current.push(unsaved);
    return <span data-testid="unsaved">{String(unsaved)}</span>;
  }

  it("goes false on the acknowledgement, with no source change and no rerender", async () => {
    const system = makeSystem();
    system.host.receive(project());
    const seen: { current: boolean[] } = { current: [] };

    render(
      <Harness system={system}>
        <Probe creatorId="mine" seen={seen} />
      </Harness>,
    );

    await act(async () => {
      await system.patchStore.createPatch(
        "/page.val.ts" as ModuleFilePath,
        [{ op: "replace", path: ["title"], value: "mine" }],
        undefined,
        "mine",
      );
    });
    expect(screen.getByTestId("unsaved").textContent).toBe("true");

    await act(async () => {
      system.patchStore.markSaved(system.patchStore.pendingPatchIds());
    });

    expect(screen.getByTestId("unsaved").textContent).toBe("false");
    system.dispose();
  });

  /** A patch from anyone else is not this field's business. */
  it("stays false for another field's unsaved edit", async () => {
    const system = makeSystem();
    system.host.receive(project());
    const seen: { current: boolean[] } = { current: [] };

    render(
      <Harness system={system}>
        <Probe creatorId="mine" seen={seen} />
      </Harness>,
    );
    await act(async () => {
      await system.patchStore.createPatch(
        "/page.val.ts" as ModuleFilePath,
        [{ op: "replace", path: ["title"], value: "theirs" }],
        undefined,
        "someone-else",
      );
    });

    expect(screen.getByTestId("unsaved").textContent).toBe("false");
    system.dispose();
  });
});

/**
 * Media FIELDS render at all, which they did not.
 *
 * `ImageField` and `FileField` each had a `useMemo` below their `loading` /
 * `not-found` / wrong-type guards. A field whose value is `null` — an
 * `s.image().nullable()` nothing has uploaded to yet — took an early return on
 * its first render and ran more hooks on its second, so React threw "Rendered
 * more hooks than during the previous render" from inside `useMemo` and the
 * Studio showed a stack trace instead of the field.
 *
 * Asserted as a render, because that is the whole failure: there is no wrong
 * VALUE to check. It reaches the components through `AnyField`, the way the
 * Studio does, so a future hook added below a guard fails here too.
 */
describe("media fields with no value", () => {
  const mediaProject = () => {
    const { c, s } = initVal();
    return [
      c.define(
        "/media.val.ts",
        s.object({
          image: s.image().nullable(),
          imageInDir: s.image({ directory: "/public/test/fields" }).nullable(),
          file: s.file().nullable(),
        }),
        { image: null, imageInDir: null, file: null },
      ),
    ];
  };

  for (const field of ["image", "imageInDir", "file"]) {
    it(`renders ${field} without throwing when it is null`, async () => {
      const system = makeSystem();
      const path = `/media.val.ts?p="${field}"` as SourcePath;

      /**
       * Mounted BEFORE the project arrives, which is the whole point.
       *
       * The crash needs the transition: the first render takes the `loading`
       * guard's early return and runs fewer hooks, then the schema lands and the
       * next render reaches the hooks below it. Receiving first and rendering
       * once never takes the early return, so it cannot fail — which is exactly
       * what an earlier version of this test did, and it passed with the bug
       * reintroduced.
       */
      system.host.receive(mediaProject());
      const view = (config?: Record<string, never>) => (
        <MediaHarness system={system} config={config}>
          <CaughtRenderError>
            <MediaFieldUnderTest path={path} />
          </CaughtRenderError>
        </MediaHarness>
      );
      // No config: both components hit `if (config === undefined) return
      // <FieldLoading/>` and run FEWER hooks.
      const { rerender } = render(view(undefined));
      // Config arrives — as it really does, from an effect in `useValConfig` —
      // and now the hooks below that guard run. That is the render that threw
      // "Rendered more hooks than during the previous render".
      await act(async () => {
        rerender(view({}));
      });
      // A THIRD render, and it is not padding. `useValConfig` keeps the config in
      // a REF that an effect populates, so the render where config arrives still
      // sees `undefined` and takes the guard again; the ref is only visible to
      // the render after that. In the Studio that render comes from any later
      // source or validation change — here it is asked for directly.
      await act(async () => {
        rerender(view({}));
      });

      expect(screen.getByTestId("render-error").textContent).toBe("none");
      expect(screen.getByTestId("mounted").textContent).toBe("mounted");
      system.dispose();
    });
  }
});

/**
 * Records a render error instead of letting it escape as console noise.
 *
 * Needed because that is exactly how the bug presented: React throws during
 * render, jsdom reports it as an uncaught error, and a test asserting on the DOM
 * still finds whatever was committed before the throw. Without this the test
 * passed with the bug reintroduced — verified.
 */
class CaughtRenderError extends React.Component<
  { children: ReactNode },
  { message: string | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { message: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  render() {
    return (
      <>
        <span data-testid="render-error">{this.state.message ?? "none"}</span>
        {this.state.message === null ? this.props.children : null}
      </>
    );
  }
}

/**
 * The providers `ImageField` and `FileField` read from, beyond the system.
 *
 * They reach for remote-file settings, the portal container and the app config,
 * each of which throws when used outside its provider. Supplied as the Studio
 * supplies them, with remote files INACTIVE — the local upload path is the one
 * under test, and a remote one would need a project and a token.
 */
function MediaHarness({
  system,
  children,
  config,
}: {
  system: System;
  children: ReactNode;
  /**
   * `undefined` makes both field components take their `config === undefined`
   * early return, which is the transition the hook-order bug needs — see the
   * test below.
   */
  config?: Record<string, never>;
}) {
  return (
    <ValSystemProvider system={system}>
      <ValThemeProvider theme="light" setTheme={() => {}} config={undefined}>
        <ValRemoteProvider remoteFiles={{ status: "not-asked" }}>
          <ValPortalProvider>
            <ValFieldProvider
              config={config}
              getDirectFileUploadSettings={async () => ({
                status: "success",
                data: {
                  nonce: null,
                  baseUrl: "/api/val/upload",
                  contentBaseUrl: null,
                  contentAuthNonce: null,
                },
              })}
            >
              {children}
            </ValFieldProvider>
          </ValPortalProvider>
        </ValRemoteProvider>
      </ValThemeProvider>
    </ValSystemProvider>
  );
}

/**
 * A probe that mounts the real field component for the schema at `path`.
 *
 * Deliberately not `AnyField`: that pulls in the whole field tree and a failure
 * anywhere in it would read as this bug. This renders the two components the bug
 * was in and nothing else.
 */
function MediaFieldUnderTest({ path }: { path: SourcePath }) {
  const schema = useSchemaAtPath(path);
  return (
    <div>
      <span data-testid="mounted">mounted</span>
      {schema.status === "success" && schema.data.type === "image" && (
        <ImageField path={path} />
      )}
      {schema.status === "success" && schema.data.type === "file" && (
        <FileField path={path} />
      )}
    </div>
  );
}
