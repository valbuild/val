/**
 * @jest-environment jsdom
 */
// FIRST, and it must stay first: the store layer builds a `TextEncoder` at module
// scope, so the polyfills have to be installed before those modules evaluate.
import "./testPolyfills";
import { act, render, screen } from "@testing-library/react";
import { initVal, type ModuleFilePath, type SourcePath } from "@valbuild/core";
import { useRef, type ReactNode } from "react";
import { createSystem, type System } from "../createSystem";
import { ValSystemProvider } from "./SystemContext";
import { useSourceAtPath } from "./useSourceAtPath";
import { useModuleSchema } from "./useSchemaAtPath";
import { useModuleValidation } from "./useValidationErrors";
import { useAddPatch, useSyncStatus, useValField } from "./useAddPatch";

/**
 * The React layer, tested against a real system.
 *
 * These tests exist because the store layer's whole value is unrealised until a
 * component can read it, and because the two claims that matter are about RENDER
 * COUNTS rather than values: a mounting field must paint once, and a keystroke
 * must not wake the fields it did not touch. Neither is visible without React in
 * the loop — `bench/` measures them but cannot assert them, and every store-level
 * test passes whether or not the hook wired to it re-renders the world.
 *
 * A real system, not a mock: the hooks' only job is to route between React and
 * the stores, so a mocked store would leave nothing under test.
 */
const project = () => {
  const { c, s } = initVal();
  return [
    c.define(
      "/page.val.ts",
      s.object({ title: s.string(), body: s.string() }),
      { title: "Hello", body: "World" },
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

/** A field that reports how many times it rendered, in its own body. */
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
  it("paints the value on the FIRST render, not the second", async () => {
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
    // THE claim this layer exists for. The engine's finest source subscription is
    // per MODULE, so `body` — a sibling in the edited module — re-renders too:
    // measured at 16 of 16 fields per keystroke. Here it does not.
    expect(body.current).toBe(before.body);
    expect(elsewhere.current).toBe(before.elsewhere);
    system.dispose();
  });

  it("leaves the field that made the edit asleep", async () => {
    const system = makeSystem();
    system.host.receive(project());
    let addPatch: ((value: string) => Promise<unknown>) | null = null;
    const renders = { current: 0 };

    function TypingField() {
      renders.current++;
      // `useValField`, not the two hooks separately. That IS the subject: each
      // `useId()` call returns a different value, so a field that reads with one
      // and writes with another registers its listener under an id the patch does
      // not name, and per-instance suppression silently stops working.
      const {
        source,
        patchPath,
        addPatch: add,
      } = useValField('/page.val.ts?p="title"' as SourcePath);
      // Captured in a ref so the test can drive it without the closure identity
      // changing what is rendered.
      const held = useRef(add);
      held.current = add;
      addPatch = (value: string) =>
        held.current([{ op: "replace", path: patchPath, value }]);
      return (
        <span data-testid="typing">
          {source.status === "success" ? String(source.data) : source.status}
        </span>
      );
    }

    render(
      <Harness system={system}>
        <TypingField />
      </Harness>,
    );
    const before = renders.current;

    await act(async () => {
      await addPatch?.("typed");
    });

    // Not woken: `useAddPatch` passes this instance's `useId` as the creator, so
    // the store leaves it alone. A field interrupted by its own keystroke loses
    // the cursor, which is the bug per-instance suppression exists to prevent.
    expect(renders.current).toBe(before);
    system.dispose();
  });

  it("wakes a second instance on the same path", async () => {
    const system = makeSystem();
    system.host.receive(project());
    const overlay = { current: 0 };
    let addPatch: ((value: string) => Promise<unknown>) | null = null;

    function TypingField() {
      const { patchPath, addPatch: add } = useValField(
        '/page.val.ts?p="title"' as SourcePath,
      );
      const held = useRef(add);
      held.current = add;
      addPatch = (value: string) =>
        held.current([{ op: "replace", path: patchPath, value }]);
      return null;
    }

    render(
      <Harness system={system}>
        <TypingField />
        <Field path='/page.val.ts?p="title"' renders={overlay} />
      </Harness>,
    );
    const before = overlay.current;

    await act(async () => {
      await addPatch?.("typed");
    });

    // Suppression is per INSTANCE, so the studio field typing does not silence
    // the inline overlay showing the same path. `useId` per hook call is what
    // makes these two listeners rather than one.
    expect(overlay.current).toBe(before + 1);
    expect(screen.getByTestId('/page.val.ts?p="title"').textContent).toBe(
      "typed",
    );
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

  /**
   * The trap `useValField` exists to close, asserted so nobody "simplifies" it
   * away. Reading with one hook's id and writing with another's is not a subtle
   * inefficiency — the field is woken by its own keystroke, which in a real text
   * input means the cursor jumps.
   */
  it("IS woken by its own edit when the read and write ids differ", async () => {
    const system = makeSystem();
    system.host.receive(project());
    const renders = { current: 0 };
    let addPatch: ((value: string) => Promise<unknown>) | null = null;

    function SeparateHooks() {
      renders.current++;
      // Deliberately the two hooks with their own ids — what a caller gets if
      // they wire it up by hand.
      const source = useSourceAtPath('/page.val.ts?p="title"' as SourcePath);
      const { patchPath, addPatch: add } = useAddPatch(
        '/page.val.ts?p="title"' as SourcePath,
      );
      const held = useRef(add);
      held.current = add;
      addPatch = (value: string) =>
        held.current([{ op: "replace", path: patchPath, value }]);
      return <span>{source.status}</span>;
    }

    render(
      <Harness system={system}>
        <SeparateHooks />
      </Harness>,
    );
    const before = renders.current;

    await act(async () => {
      await addPatch?.("typed");
    });

    expect(renders.current).toBe(before + 1);
    system.dispose();
  });
});

describe("useModuleSchema", () => {
  it("hands back the serialized schema once intake has run", async () => {
    const system = makeSystem();
    let seen: unknown = null;

    function SchemaReader() {
      seen = useModuleSchema('/page.val.ts?p="title"' as SourcePath);
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

    expect(seen).toMatchObject({
      status: "success",
      data: { type: "object" },
    });
    system.dispose();
  });
});

describe("useModuleValidation", () => {
  /**
   * The hook IS the demand signal. `peek` reports `stale` and never computes;
   * the effect calls `validate`. So mounting a field is what makes validation
   * happen, and nothing pays for it before then.
   */
  it("validates the module it is asked about", async () => {
    const system = makeSystem();
    system.host.receive(project());
    let seen: unknown = null;

    function ErrorReader() {
      seen = useModuleValidation("/page.val.ts" as ModuleFilePath);
      return null;
    }
    await act(async () => {
      render(
        <Harness system={system}>
          <ErrorReader />
        </Harness>,
      );
    });

    expect(seen).toMatchObject({ status: "validated" });
    system.dispose();
  });
});

describe("useSyncStatus", () => {
  it("reports a local edit as pending when there is nowhere to write it", async () => {
    const system = makeSystem();
    system.host.receive(project());
    system.stat.receiveStat({ patches: [], baseSha: "sha" });
    // Written through a mutable box rather than a `let`, because TS narrows a
    // `let` assigned only inside a component to `never` at the assertion site.
    const box: { seen: ReturnType<typeof useSyncStatus> | null } = {
      seen: null,
    };

    function StatusReader() {
      box.seen = useSyncStatus();
      return null;
    }
    render(
      <Harness system={system}>
        <StatusReader />
      </Harness>,
    );
    expect(box.seen?.state.status).toBe("in-sync");

    await act(async () => {
      await system.patchStore.createPatch("/page.val.ts" as ModuleFilePath, [
        { op: "replace", path: ["title"], value: "unsaved" },
      ]);
      await system.patchSync.flush();
    });

    // `pending`, because this system has no write seam. Emphatically not
    // `in-sync` — an edit reporting itself saved while nothing left the tab is
    // the worst outcome available.
    expect(box.seen?.state.status).toBe("pending");
    system.dispose();
  });
});
