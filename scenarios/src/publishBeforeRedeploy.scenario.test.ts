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
 * Two publishes into one file, and no deployment in between.
 *
 * Val does not hold Publish back while a deployment is pending, so the
 * second publish runs on the build the first one has not replaced yet. Its
 * base text is that build's -- read from the repository at the build's
 * commit, or embedded in the build (`projectSource`, as `valProjectSource()`
 * makes for a self-hosted site) -- and the first publish's change is in the
 * chain as published (`appliedAt`), not pending. A publish that patched the
 * base text with its own changes alone committed a file without the first
 * one's: the second publish silently reverted it.
 *
 * Both sources of the base text, because they are two paths to it.
 * `e2e/http/publish.spec.ts` is the same through a browser, from the
 * repository; `preparePublishedSinceBuild.test.ts` is it at `prepare`.
 */

const { s, c, config } = initVal({});
const PATH = "/content/home.val.ts";
const homeVal = c.define(
  PATH,
  s.object({ title: s.string(), subtitle: s.string() }),
  { title: "Hello", subtitle: "Sub" },
);
const HOME_TEXT = `import { c, s } from "../val.config";

export default c.define(
  "${PATH}",
  s.object({ title: s.string(), subtitle: s.string() }),
  { title: "Hello", subtitle: "Sub" },
);
`;

const BASES: { base: string; embedsSource?: true }[] = [
  { base: "from the repository" },
  { base: "embedded in the build", embedsSource: true },
];

describe.each(BASES)(
  "a second publish before a redeploy, base text $base",
  ({ embedsSource }) => {
    let world: World | null = null;
    afterEach(async () => {
      await world?.dispose();
      world = null;
    });

    test("keeps what the first publish changed in the same file", async () => {
      world = await createWorld({
        config,
        modules: [homeVal],
        server: "http",
        sourceText: { [PATH]: HOME_TEXT },
        ...(embedsSource ? { embedsSource } : {}),
      });
      if (world.server.mode !== "http") throw new Error("not on http");
      const contentUrl = world.server.contentUrl;
      const editor = await world.studio("editor");

      await editor.edit(homeVal, ["title"], "First publish");
      await world.settle();
      expect((await editor.publish()).status).toBe("published");
      await world.settle();

      // No redeploy: the site still runs the build from before either.
      await editor.edit(homeVal, ["subtitle"], "Second publish");
      await world.settle();
      expect((await editor.publish()).status).toBe("published");

      const res = await fetch(
        `${contentUrl}/__test__/committed-source?path=${encodeURIComponent(PATH)}`,
      );
      const body: unknown = await res.json();
      const content =
        typeof body === "object" &&
        body !== null &&
        "content" in body &&
        typeof body.content === "string"
          ? body.content
          : null;
      expect(content).toContain("Second publish");
      // What a second publish that reverts the first one loses.
      expect(content).toContain("First publish");
    });
  },
);
