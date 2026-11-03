import type { ModuleFilePath } from "@valbuild/core";
import { keyOfScanScope } from "../../packages/ui/spa/components/getKeysOf";
import {
  FEATURED,
  POSTS,
  keystroke,
  openPickingPage,
  scaleConfig,
  scaleProject,
  scaleSizesFrom,
  type MediaRefs,
} from "../measure/scaleWork";
import type { WorkKind } from "../../packages/ui/spa/stores/activity";
import { createWorld, type World } from "./world/createWorld";

// See `smoke.scenario.test.ts` and the README for these two.
jest.mock(
  "@tanstack/react-start/server",
  () => jest.requireActual("./world/tanstackStart"),
  { virtual: true },
);
jest.mock("../../packages/ui/spa/validation/schemaValidationBridge", () =>
  jest.requireActual("./world/noWorkerBridge"),
);

/**
 * Phase 10: typing on the page that picks from the libraries, at size.
 *
 * In the browser it froze for 1.1 s per keystroke at 10,000 entries a
 * library (14 s at 100,000), with nothing of the libraries on screen: the
 * page re-ran whole-project work on every keystroke -- every `.jsonValues()`
 * marker counted per progress read, the header's `keyOf` scan walking every
 * library, the shell's file lists sorted again, the dropdown's options built
 * while closed. The React half of that is pinned by the components' own
 * tests (`KeySelector.test.tsx`, `MediaGallery.test.tsx`); this is the
 * stores' half, and the decisions the page makes about what to scan.
 *
 * The gate: the same keystrokes on the same page cost the same work in a
 * project of 10 entries per library and one of N -- requests, the engine's
 * copies, versions hashed, listeners woken, entries counted, previews and
 * validations run. `VAL_SCALE=1000,10000,100000 pnpm test scenarios/src/scalePage`.
 */

const SIZES = scaleSizesFrom(process.env.VAL_SCALE, [1_000]);
const MEDIA: MediaRefs[] = (process.env.VAL_SCALE_MEDIA ?? "local,remote")
  .split(",")
  .map((part) => part.trim())
  .filter((part): part is MediaRefs => part === "local" || part === "remote");
const SMALL = 10;
const KEYSTROKES = 10;

jest.setTimeout(Math.max(...SIZES) >= 100_000 ? 1_800_000 : 300_000);

/** The Studio's work that could grow with a library; amounts are summed. */
const COUNTED: WorkKind[] = [
  "source:clone-module",
  "source:apply-patch",
  "source:wake-listener",
  "source:count-entries",
  "source:load-json-entry",
  "source:rebuild-module",
  "host:execute-preview",
  "preview:cache-miss",
  "host:execute-validate",
  "validation:schema-validate",
  "patch:save",
];
const SUMMED: WorkKind[] = [
  "engine:clone-bytes",
  "version:hash",
  "source:count-entries",
];

type Typed = {
  requests: Record<string, number>;
  studio: Record<string, number>;
  server: Record<string, number>;
  scan: { parent: string } | null;
  scope: string[];
};

/** Open the page in a project of `entries`, and type into its title. */
async function typeOnThePage(
  entries: number,
  media: MediaRefs,
): Promise<{ typed: Typed; world: World }> {
  const project = scaleProject({ entries, media });
  const world = await createWorld({
    config: scaleConfig,
    modules: project.modules,
    server: "memory",
    sourceText: project.sourceText([]),
  });
  const editor = await world.studio("editor");
  await world.settle();
  const page = await openPickingPage(editor.system, project);
  await world.settle();

  const log = world.network.log.length;
  const studioSince = editor.work.position();
  const serverSince = world.workPosition();
  for (let i = 0; i < KEYSTROKES; i++) {
    await keystroke(
      editor.system,
      FEATURED,
      ["title"],
      `Featured${"!".repeat(i + 1)}`,
    );
  }
  await world.settle();

  const requests: Record<string, number> = {};
  for (const exchange of world.network.log.slice(log)) {
    const name = `${exchange.method} ${exchange.path.replace("/api/val", "")}`;
    requests[name] = (requests[name] ?? 0) + 1;
  }
  const studio: Record<string, number> = {};
  for (const kind of COUNTED) {
    studio[kind] = editor.work.count(kind, { since: studioSince });
  }
  for (const kind of SUMMED) {
    studio[`${kind} (amount)`] = editor.work.total(kind, {
      since: studioSince,
    });
  }
  const server = world.workPosition();
  page.unmount();
  expect(editor.errors()).toEqual([]);
  return {
    world,
    typed: {
      requests,
      studio,
      server: {
        "version:hash": server.versionHashes - serverSince.versionHashes,
        "engine:apply-patch": server.engineApplies - serverSince.engineApplies,
        "engine:clone-bytes":
          server.engineCloneBytes - serverSince.engineCloneBytes,
      },
      scan: page.scan,
      scope: Object.keys(
        keyOfScanScope(editor.system.schemaStore.all(), POSTS),
      ),
    },
  };
}

describe.each(MEDIA)("%s media", (media) => {
  let small: Typed | null = null;
  beforeAll(async () => {
    const { typed, world } = await typeOnThePage(SMALL, media);
    await world.dispose();
    small = typed;
  });

  test.each(SIZES)(
    "typing on the page that picks costs the same at %d entries a library as at 10",
    async (n) => {
      const { typed, world } = await typeOnThePage(n, media);
      await world.dispose();
      process.stdout.write(
        `\nTyping ${KEYSTROKES} characters on the page that picks, ${n} entries (${media}): ${JSON.stringify(typed)}\n`,
      );
      // The page makes no reference scan: it is not a record, nor an entry
      // of one, so nothing on it shows references...
      expect(typed.scan).toBeNull();
      // ...and a scan for references to the record it points at walks the
      // page and nothing else: no library can hold a `keyOf`.
      expect(typed.scope).toEqual([FEATURED satisfies ModuleFilePath]);
      // The libraries' entries are never counted for a keystroke on the page.
      expect(typed.studio["source:count-entries (amount)"]).toBeLessThanOrEqual(
        2 * KEYSTROKES * 5,
      );
      // And all of it is what the same keystrokes cost next to libraries of
      // ten.
      expect(typed).toEqual(small);
    },
  );
});
