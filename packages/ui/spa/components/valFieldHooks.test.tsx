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
import { useRef, type ReactNode } from "react";
import { createSystem, type System } from "../stores/createSystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import {
  useAddPatch,
  useFieldCreatorId,
  useLoadingStatus,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useSourceAtPath,
} from "./ValFieldProvider";
import { useValidationErrors } from "./ValErrorProvider";

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
