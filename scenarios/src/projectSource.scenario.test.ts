import { initVal } from "@valbuild/core";
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
 * The Studio's code tools read the SITE's source -- what its live build was
 * made from -- whenever they read a file the proposal has not changed. They
 * held the first answer for as long as the editor had the page open (the
 * publish client's memo), so a publish of the site in between went unseen:
 * `read_file` showed the code from before it.
 *
 * Now they read it BY VERSION (phase 7; valbuild/home's `ETag` on
 * `/v1/project-source`): every tool call asks, with the tag of the answer it
 * holds, through the app's `/publish-api`; content answers 304 while nothing
 * moved, and the whole source only when it did. The world runs the
 * assistant's `read_file` as the Studio does (`runCodeTool`, with
 * `createProjectSourceReader`), against the mock content host.
 */

const { s, c, config } = initVal({});
const HOME = "/content/home.val.ts";
const homeVal = c.define(HOME, s.object({ title: s.string() }), {
  title: "Hello",
});
const HERO = "src/components/Hero.tsx";

describe("the code tools' site source, on http", () => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
  });

  test("is read by version: a publish in between is seen, and nothing else is sent again", async () => {
    world = await createWorld({
      config,
      modules: [homeVal],
      server: "http",
      proposal: { open: "Spring campaign" },
    });
    const proposal = world.proposal;
    if (proposal === null) throw new Error("not at a proposal's address");
    if (world.server.mode !== "http") throw new Error("not on http");
    const contentUrl = world.server.contentUrl;
    /** What a publish of the site leaves the platform holding. */
    const publish = async (files: Record<string, string>) => {
      const res = await fetch(`${contentUrl}/__test__/project-source`, {
        method: "PUT",
        body: JSON.stringify({ files }),
      });
      expect(res.ok).toBe(true);
    };
    const reads = () =>
      world!.network.log
        .filter((e) => e.path.endsWith("/publish-api/project-source"))
        .map((e) => e.status);
    const heroText = async () => {
      const answer = await proposal.readFile(HERO);
      expect(answer.isError).toBe(false);
      const { text } = answer.result as { text: string };
      return text;
    };

    await publish({ [HERO]: "export const Hero = 1;\n" });
    expect(await heroText()).toBe("export const Hero = 1;\n");
    // Asked again, and told nothing moved: no source on the wire.
    expect(await heroText()).toBe("export const Hero = 1;\n");
    expect(reads()).toEqual([200, 304]);

    // The site publishes while the assistant works: the next call sees it.
    await publish({ [HERO]: "export const Hero = 2;\n" });
    expect(await heroText()).toBe("export const Hero = 2;\n");
    expect(reads()).toEqual([200, 304, 200]);
  });
});
