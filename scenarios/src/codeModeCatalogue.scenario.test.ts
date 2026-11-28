import { initVal } from "@valbuild/core";
import type { World } from "./world/createWorld";
import { buildLands, ok, openCodeModeProposal } from "./world/codeMode";
import { resetCodeMode } from "../../packages/ui/spa/proposals/codeMode";
import { resetStagedCode } from "../../packages/ui/spa/proposals/stagedCode";
import {
  casesAt,
  knownToFailAt,
  siteOf,
} from "../../e2e/proposal/codeModeCases";

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
 * The code-mode catalogue at the `headless` level
 * (`e2e/proposal/codeModeCases.ts`): each case's scripted turns run by the
 * assistant's tools as `useAI` runs them, against Val's real server at a
 * proposal's address, and then a Build lands.
 *
 * Held for every case:
 * - I1, the tools answer truthfully: every call succeeds, unless the case
 *   says which should not.
 * - I2, what is staged is what was written: `read_file` reads back each
 *   staged file, as the proposal's, and a deleted one is gone.
 * - Lint and typecheck report what the case says, where it says.
 * - I5/I6, a Build lands and the Studio does not reload for it.
 *
 * What the page is handed for the change -- its code and its CSS -- is the
 * `build` level's (`packages/cli/src/publish/codeModeCatalogue.test.ts`):
 * nothing here bundles.
 */

const { s, c, config } = initVal({});
const HOME = "/content/home.val.ts";
const home = c.define(HOME, s.object({ title: s.string() }), {
  title: "Dette er så gøy",
});
const homeText = `import { c, s } from "../val.config";

export default c.define(
  "${HOME}",
  s.object({ title: s.string() }),
  { title: "Dette er så gøy" },
);
`;

let world: World | null = null;
afterEach(async () => {
  await world?.dispose();
  world = null;
  resetCodeMode();
  resetStagedCode();
});

describe.each(casesAt("headless"))("$id $title", (k) => {
  const run = knownToFailAt(k, "headless") ? test.failing : test;

  run("the tools stage the change, and a Build of it lands", async () => {
    const opened = await openCodeModeProposal({
      config,
      modules: [home],
      moduleText: { [HOME]: homeText },
      code: siteOf(k),
    });
    world = opened.world;
    const { editor, assistant } = opened;

    // I1: each call answers, as the case says it should.
    const errors = new Set(
      (k.expect.toolErrors ?? []).map(([turn, call]) => `${turn}:${call}`),
    );
    for (const [t, turn] of k.turns.entries()) {
      for (const [i, step] of turn.entries()) {
        const answer = await assistant.run(step.name, step.arguments);
        expect({
          call: `${t}:${i} ${step.name}`,
          isError: answer.isError,
          ...(answer.isError && !errors.has(`${t}:${i}`)
            ? { result: answer.result }
            : {}),
        }).toEqual({
          call: `${t}:${i} ${step.name}`,
          isError: errors.has(`${t}:${i}`),
        });
      }
      await world.settle();
    }

    // I2: what is staged is what was written.
    for (const [path, text] of Object.entries(k.expect.staged)) {
      const read = await assistant.run("read_file", { path });
      if (text === null) {
        expect({ path, isError: read.isError }).toEqual({
          path,
          isError: true,
        });
      } else {
        const answer = ok(read);
        expect({ path, text: answer.text, staged: answer.staged }).toEqual({
          path,
          text,
          staged: true,
        });
      }
    }

    if (k.expect.lint !== undefined) {
      const lint = await assistant.run("lint", {});
      const problems = problemsOf(lint.result);
      expect({ lint: problems === 0 ? "ok" : { problems } }).toEqual({
        lint: k.expect.lint,
      });
    }

    // I5/I6: a Build lands, and the Studio does not reload for it.
    if (k.expect.build === "no-reload") {
      await buildLands(world);
      await world.observe();
      expect(editor.reloads()).toBe(0);
      expect(editor.errors()).toEqual([]);
      world.expectInvariants();
    }
  });
});

/** How many problems a `lint` answer reports. */
function problemsOf(result: unknown): number {
  const problems: unknown = Reflect.get(Object(result), "problems");
  if (Array.isArray(problems)) return problems.length;
  const count: unknown = Reflect.get(Object(result), "count");
  if (typeof count === "number") return count;
  throw new Error(`a lint answer with no problems: ${JSON.stringify(result)}`);
}
