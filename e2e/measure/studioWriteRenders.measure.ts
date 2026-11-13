/**
 * What one field write RENDERS in the Studio, and why: the same typing as
 * `studioWriteLag.measure.ts` (the hero title of the TanStack showcase's
 * `/landing`, through "On this page"), with a census of every React commit
 * instead of a CPU profile.
 *
 * The profile says how long; this says who. Milliseconds move with the
 * machine and the build, and a count of components rendered does not (see
 * `scenarios/measure/README.md`: gate on counted work), so this is the one to
 * compare before and after a change.
 *
 * NOT a test, and named so that no Playwright project picks it up: it types
 * into real content and discards every unsaved patch when it is done. To run
 * it, against a dev server on 3458 that has NO unsaved patches (it refuses
 * to start otherwise):
 *
 *   cp e2e/measure/studioWriteRenders.measure.ts e2e/tanstack/zzWriteRenders.spec.ts
 *   pnpm exec playwright test --project=tanstack e2e/tanstack/zzWriteRenders.spec.ts --trace off --reporter=line
 *   rm e2e/tanstack/zzWriteRenders.spec.ts
 *
 * It types twice -- the first write to a page also gives it its draft marker
 * and makes Publish possible, so the second is the one that says what a
 * write costs while someone keeps typing -- and prints, for each commit of
 * the Studio's React root after each typing starts: when, how many
 * components rendered, which ones, and:
 *
 * - what WOKE: the components that rendered with a parent that did not, with
 *   what moved for them (a state, a store snapshot, a context);
 * - what DID NOT HOLD: a `memo` that rendered with its parent, with the props
 *   that moved, since that is a boundary that was meant to stop the render;
 * - which components rendered with their parent while reading something that
 *   moved too: a `memo` above those would not have kept them asleep.
 *
 * `RENDERS_ALL=1` lists every component of every commit and what moved for
 * each, rather than the first 25 names.
 *
 * How it knows: a minimal `__REACT_DEVTOOLS_GLOBAL_HOOK__` installed before
 * the page loads, which React calls on every commit. A fiber rendered in a
 * commit when it carries `PerformedWork` and was reached from the root
 * through fibers whose children were re-made; what moved is read by comparing
 * its hooks and context dependencies with its alternate's. Development build
 * only: the hook names come from `_debugHookTypes`.
 *
 * See `docs/plans/studio-write-lag.md` for what it found.
 */
import { expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import path from "node:path";
import { discardAll, openStudio, test } from "../studio";

const MODULE = "/src/routes/_site.landing.val.ts";
const STUDIO = `/val/~${MODULE}?p=${encodeURIComponent('"/landing"')}`;
const PATCHES = path.join(
  __dirname,
  "..",
  "..",
  "examples",
  "tanstack",
  ".val",
  "patches",
);
const TYPED = " lagging or not";
const TYPED_AGAIN = ", still";
const KEY_GAP_MS = 120;
/** How many component names a commit lists, unless `RENDERS_ALL=1`. */
const LISTED = 25;

test.use({ viewport: { width: 1512, height: 900 } });

/** `own`: its parent did not render, so what moved here is what woke it. */
type Cause = { name: string; own: boolean; why: string[] };
type Commit = {
  at: number;
  rendered: number;
  mounted: number;
  byName: Record<string, number>;
  causes: Cause[];
};

test("one field write, by what it renders", async ({ page }) => {
  test.setTimeout(240_000);
  let entries: string[] = [];
  try {
    entries = readdirSync(PATCHES);
  } catch {
    // No patch directory: nothing to lose
  }
  const unsaved = entries.filter((entry) => entry !== "patches.log");
  expect(
    unsaved,
    "there are unsaved patches, which this would discard: save or discard them first",
  ).toEqual([]);

  await page.addInitScript(installCensus);

  await openStudio(page, STUDIO);
  await page.getByRole("button", { name: "Open the canvas" }).click();
  await expect(page.getByRole("tab", { name: /On this page \d/ })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Edit on the page" }).click();
  const frame = page.frameLocator('iframe[title="Preview of /landing"]');
  const title = frame.locator("main h1").first();
  const titleText = (await title.innerText()).trim();
  // A click on the page puts the cursor in its field
  await title.click();
  const active = () =>
    page.evaluate(() => {
      const element =
        document.getElementById("val-shadow-root")?.shadowRoot?.activeElement;
      return element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
        ? element.value
        : (element?.textContent ?? null);
    });
  await expect.poll(active, { timeout: 10_000 }).toBe(titleText);
  await page.keyboard.press("End");
  await page.waitForTimeout(1000);

  /** Type `text`, wait out the write and its confirmation, and say what rendered. */
  const typeAndSettle = async (text: string) => {
    await page.evaluate(() => {
      const census = Reflect.get(window, "__census");
      census.commits = [];
      census.start = performance.now();
      census.recording = true;
    });
    for (const character of text) {
      await page.keyboard.type(character);
      await page.waitForTimeout(KEY_GAP_MS);
    }
    const typedAt: number = await page.evaluate(
      () => performance.now() - Reflect.get(window, "__census").start,
    );
    await page.waitForTimeout(3000);
    const commits: Commit[] = await page.evaluate(() => {
      const census = Reflect.get(window, "__census");
      census.recording = false;
      return census.commits;
    });
    return { commits, typedAt, keystrokes: text.length };
  };

  /*
   * Twice, because the first write to a page is not the usual one: it is
   * also when the page gets its draft marker, Publish becomes possible and
   * the count leaves zero. The second is what every write after it costs.
   */
  const first = await typeAndSettle(TYPED);
  const second = await typeAndSettle(TYPED_AGAIN);
  expect(await active(), "the typing went into the title").toBe(
    titleText + TYPED + TYPED_AGAIN,
  );

  console.log(
    [
      "THE FIRST WRITE TO THE PAGE",
      report(first.commits, first.typedAt, first.keystrokes),
      "",
      "THE NEXT WRITE",
      report(second.commits, second.typedAt, second.keystrokes),
    ].join("\n"),
  );
  await discardAll(page);
});

function report(
  commits: Commit[],
  typedAt: number,
  keystrokes: number,
): string {
  const all = process.env.RENDERS_ALL === "1";
  const typing = commits.filter((commit) => commit.at <= typedAt);
  const after = commits.filter((commit) => commit.at > typedAt);
  const sum = (list: Commit[]) =>
    list.reduce((total, commit) => total + commit.rendered, 0);
  const lines = [
    `${keystrokes} keystrokes, the last at ${Math.round(typedAt)} ms, then 3 s idle`,
    `while typing: ${typing.length} commits, ${sum(typing)} component renders` +
      ` (${Math.round(sum(typing) / keystrokes)} per keystroke)`,
    `after the last key: ${after.length} commits, ${sum(after)} component renders`,
  ];
  // The commits of the typing are the same few components per key: one line.
  const typingNames = new Map<string, number>();
  for (const commit of typing) {
    for (const [name, count] of Object.entries(commit.byName)) {
      typingNames.set(name, (typingNames.get(name) ?? 0) + count);
    }
  }
  lines.push(
    `  typing renders: ${listNames(typingNames, all ? 1000 : LISTED)}`,
  );
  for (const commit of after) {
    lines.push(
      `commit at ${Math.round(commit.at)} ms (+${Math.round(commit.at - typedAt)}): ` +
        `${commit.rendered} rendered, ${commit.mounted} mounted`,
    );
    lines.push(
      `  ${listNames(new Map(Object.entries(commit.byName)), all ? 1000 : LISTED)}`,
    );
    for (const cause of commit.causes) {
      if (!cause.own && !all) continue;
      lines.push(
        `  ${cause.own ? "woke" : "moved, rendering with its parent"}: ${cause.name}`,
      );
      for (const why of cause.why) lines.push(`    ${why}`);
    }
    // Always said, whatever is listed: a `memo` whose props moved is a
    // boundary that was meant to hold and did not.
    for (const cause of commit.causes) {
      if (cause.own || all) continue;
      const memo = cause.why.filter((why) => why.startsWith("a memo"));
      if (memo.length === 0) continue;
      lines.push(`  did not hold: ${cause.name}`);
      for (const why of memo) lines.push(`    ${why}`);
    }
    const withParent = commit.causes.filter((cause) => !cause.own);
    if (!all && withParent.length > 0) {
      const names = new Map<string, number>();
      for (const cause of withParent) {
        names.set(cause.name, (names.get(cause.name) ?? 0) + 1);
      }
      lines.push(
        `  rendering with a parent, and something of their own moved too: ${listNames(names, LISTED)}`,
      );
    }
  }
  return lines.join("\n");
}

function listNames(names: Map<string, number>, limit: number): string {
  const sorted = Array.from(names.entries()).sort(([, a], [, b]) => b - a);
  const listed = sorted
    .slice(0, limit)
    .map(([name, count]) => (count === 1 ? name : `${name}×${count}`));
  const rest = sorted.length - listed.length;
  return listed.join(" ") + (rest > 0 ? ` … and ${rest} more names` : "");
}

/**
 * Runs in the page, before any of its scripts: nothing from this file's
 * scope is available in it.
 */
function installCensus() {
  if (window !== window.top) return;
  type Hook = {
    memoizedState: unknown;
    queue: unknown;
    next: Hook | null;
  };
  type ContextDependency = {
    context: { displayName?: string };
    memoizedValue: unknown;
    next: ContextDependency | null;
  };
  type Fiber = {
    tag: number;
    flags: number;
    type: unknown;
    elementType: unknown;
    alternate: Fiber | null;
    child: Fiber | null;
    sibling: Fiber | null;
    memoizedProps: unknown;
    memoizedState: unknown;
    dependencies: { firstContext: ContextDependency | null } | null;
    _debugHookTypes?: string[] | null;
  };
  const census: {
    recording: boolean;
    start: number;
    commits: unknown[];
  } = { recording: false, start: 0, commits: [] };
  Reflect.set(window, "__census", census);

  const FUNCTION = 0;
  const CLASS = 1;
  const PROVIDER = 10;
  const FORWARD_REF = 11;
  const MEMO = 14;
  const SIMPLE_MEMO = 15;
  const PERFORMED_WORK = 1;
  /** How many slots of the hook list each hook takes. */
  const SLOTS: Record<string, number> = {
    useContext: 0,
    use: 0,
    useDebugValue: 0,
    useSyncExternalStore: 2,
    useTransition: 2,
  };

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

  function nameOf(fiber: Fiber): string {
    const type = fiber.type;
    if (typeof type === "function") {
      return (
        (Reflect.get(type, "displayName") as string | undefined) ||
        type.name ||
        "(anonymous)"
      );
    }
    if (isRecord(type)) {
      const displayName = type.displayName;
      if (typeof displayName === "string") return displayName;
      const inner = type.render ?? type.type;
      if (typeof inner === "function") {
        return (
          (Reflect.get(inner, "displayName") as string | undefined) ||
          inner.name ||
          "(anonymous)"
        );
      }
      if (isRecord(inner) && typeof inner.render === "function") {
        return inner.render.name || "(anonymous)";
      }
    }
    return "(unknown)";
  }

  function describe(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === "string") {
      return JSON.stringify(
        value.length > 40 ? value.slice(0, 40) + "…" : value,
      );
    }
    if (typeof value === "function") return `fn ${value.name || ""}`.trim();
    if (typeof value !== "object") return String(value);
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (value instanceof Map) return `Map(${value.size})`;
    if (value instanceof Set) return `Set(${value.size})`;
    const keys = Object.keys(value);
    return `{${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", …" : ""}}`;
  }

  /** What moved between two values, as far as one level down. */
  function difference(previous: unknown, next: unknown): string {
    if (
      isRecord(previous) &&
      isRecord(next) &&
      !Array.isArray(previous) &&
      !Array.isArray(next) &&
      !(previous instanceof Map) &&
      !(previous instanceof Set)
    ) {
      const keys = new Set(Object.keys(previous).concat(Object.keys(next)));
      const moved = Array.from(keys).filter(
        (key) => !Object.is(previous[key], next[key]),
      );
      if (moved.length === 0) return `${describe(next)}, a new object alike`;
      return (
        "keys moved: " +
        moved
          .slice(0, 10)
          .map(
            (key) =>
              `${key} (${describe(previous[key])} → ${describe(next[key])})`,
          )
          .join(", ") +
        (moved.length > 10 ? ", …" : "")
      );
    }
    return `${describe(previous)} → ${describe(next)}`;
  }

  /** The hook each slot of the list belongs to, or null when they do not add up. */
  function slotNames(fiber: Fiber): string[] | null {
    const types = fiber._debugHookTypes;
    if (!types) return null;
    const names: string[] = [];
    const ordinals = new Map<string, number>();
    for (const type of types) {
      const ordinal = (ordinals.get(type) ?? 0) + 1;
      ordinals.set(type, ordinal);
      for (let slot = 0; slot < (SLOTS[type] ?? 1); slot++) {
        names.push(`${type} #${ordinal}`);
      }
    }
    let count = 0;
    let hook = fiber.memoizedState as Hook | null;
    while (hook) {
      count += 1;
      hook = hook.next;
    }
    return count === names.length ? names : null;
  }

  function contextNames(fiber: Fiber): number[] {
    // The ordinal of each `useContext` among the component's hooks
    const ordinals: number[] = [];
    (fiber._debugHookTypes ?? []).forEach((type, index) => {
      if (type === "useContext" || type === "use") ordinals.push(index + 1);
    });
    return ordinals;
  }

  function whyRendered(fiber: Fiber, previous: Fiber): string[] {
    const why: string[] = [];
    if (
      fiber.tag === FUNCTION ||
      fiber.tag === FORWARD_REF ||
      fiber.tag === SIMPLE_MEMO
    ) {
      const names = slotNames(fiber);
      let hook = fiber.memoizedState as Hook | null;
      let before = previous.memoizedState as Hook | null;
      let slot = 0;
      while (hook && before) {
        // Only what can schedule a render: a state, a reducer, a store
        if (
          hook.queue !== null &&
          !Object.is(hook.memoizedState, before.memoizedState)
        ) {
          const queue = hook.queue;
          const getSnapshot =
            isRecord(queue) && typeof queue.getSnapshot === "function"
              ? String(queue.getSnapshot).replace(/\s+/g, " ").slice(0, 90)
              : null;
          why.push(
            `${names?.[slot] ?? `hook slot ${slot}`}: ` +
              difference(before.memoizedState, hook.memoizedState) +
              (getSnapshot ? `   [${getSnapshot}]` : ""),
          );
        }
        hook = hook.next;
        before = before.next;
        slot += 1;
      }
    }
    let dependency = fiber.dependencies?.firstContext ?? null;
    let dependencyBefore = previous.dependencies?.firstContext ?? null;
    const ordinals = contextNames(fiber);
    let index = 0;
    while (dependency && dependencyBefore) {
      if (
        !Object.is(dependency.memoizedValue, dependencyBefore.memoizedValue)
      ) {
        why.push(
          `context ${dependency.context.displayName ?? ""} (hook ${ordinals[index] ?? "?"}): ` +
            difference(
              dependencyBefore.memoizedValue,
              dependency.memoizedValue,
            ),
        );
      }
      dependency = dependency.next;
      dependencyBefore = dependencyBefore.next;
      index += 1;
    }
    // One context read twice is one cause
    return Array.from(
      new Set(why.map((line) => line.replace(/ \(hook [^)]*\)/, ""))),
    );
  }

  function commitOf(root: { current: Fiber }) {
    const byName: Record<string, number> = {};
    const causes: { name: string; own: boolean; why: string[] }[] = [];
    let rendered = 0;
    let mounted = 0;
    const visit = (fiber: Fiber, parentRendered: boolean) => {
      const previous = fiber.alternate;
      const isComponent =
        fiber.tag === FUNCTION ||
        fiber.tag === CLASS ||
        fiber.tag === FORWARD_REF ||
        fiber.tag === MEMO ||
        fiber.tag === SIMPLE_MEMO;
      let didRender = false;
      if (previous === null) {
        if (isComponent) mounted += 1;
      } else if (isComponent && (fiber.flags & PERFORMED_WORK) !== 0) {
        didRender = true;
        rendered += 1;
        const name = nameOf(fiber);
        byName[name] = (byName[name] ?? 0) + 1;
        const why = whyRendered(fiber, previous);
        // A `memo` that rendered with its parent is one that did not hold:
        // which of its props moved is why.
        if (
          parentRendered &&
          isRecord(fiber.elementType) &&
          fiber.elementType.$$typeof === Symbol.for("react.memo") &&
          !Object.is(previous.memoizedProps, fiber.memoizedProps)
        ) {
          why.push(
            "a memo, and its props moved: " +
              difference(previous.memoizedProps, fiber.memoizedProps),
          );
        }
        if (why.length > 0) {
          causes.push({ name, own: !parentRendered, why });
        } else if (!parentRendered) {
          // A memo whose props moved, or a parent that is not a component
          const props = difference(previous.memoizedProps, fiber.memoizedProps);
          causes.push({ name, own: true, why: [`props: ${props}`] });
        }
      } else if (
        fiber.tag === PROVIDER &&
        isRecord(fiber.memoizedProps) &&
        isRecord(previous.memoizedProps) &&
        !Object.is(fiber.memoizedProps.value, previous.memoizedProps.value)
      ) {
        const context = fiber.type;
        const displayName =
          isRecord(context) && typeof context.displayName === "string"
            ? context.displayName
            : "";
        causes.push({
          name: `<Provider ${displayName}>`,
          own: !parentRendered,
          why: [
            "value: " +
              difference(
                previous.memoizedProps.value,
                fiber.memoizedProps.value,
              ),
          ],
        });
      }
      // A subtree that bailed out keeps the fibers it had, flags and all
      if (previous !== null && fiber.child === previous.child) return;
      let child = fiber.child;
      while (child) {
        visit(child, isComponent ? didRender : parentRendered);
        child = child.sibling;
      }
    };
    visit(root.current, false);
    return {
      at: performance.now() - census.start,
      rendered,
      mounted,
      byName,
      causes,
    };
  }

  let renderers = 0;
  Reflect.set(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
    supportsFiber: true,
    renderers: new Map(),
    inject() {
      renderers += 1;
      return renderers;
    },
    onCommitFiberRoot(_id: number, root: { current: Fiber }) {
      if (!census.recording) return;
      try {
        const commit = commitOf(root);
        if (commit.rendered > 0 || commit.mounted > 0) {
          census.commits.push(commit);
        }
      } catch (error) {
        census.commits.push({
          at: performance.now() - census.start,
          rendered: 0,
          mounted: 0,
          byName: {},
          causes: [
            { name: "(census failed)", own: true, why: [String(error)] },
          ],
        });
      }
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  });
}
