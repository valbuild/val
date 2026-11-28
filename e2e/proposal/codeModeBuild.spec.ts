import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MOCK_PROPOSAL } from "../http/config";
import { send, toolCalls } from "../http/assistant";
import {
  arriveInCodeMode,
  mock,
  sessionCookie,
  watchForReload,
} from "./codeModeStudio";

/**
 * Build, after a coding session in code mode, does not reload the Studio.
 *
 * Reported: at a proposal made by `</>` on the site, "clicking the Build
 * button after a coding session refreshes the whole page". A reload in code
 * mode throws away what is on screen -- the assistant's turn, the canvas,
 * where the editor was -- for nothing: the Studio asked for the build.
 *
 * The Studio arrives the way `</>` on the site sends it: at the proposal's
 * address with `?val_code_mode=on` (`withCodeModeParam`), which turns code
 * mode on there. The coding session is the mock's scripted turn (no model):
 * one `write_files` of a component, as the reported session changed
 * `HeroSection.tsx`. Then Build, as a person presses it: the main button,
 * which saves and updates the preview, in the hammer state while the preview
 * is behind the staged code.
 *
 * Val Build builds it (`mock.serverBuilds()`), as it builds every project on
 * Val's hosting. The mock bundles nothing, and the address goes on serving
 * the app it serves, so what this covers is everything the Studio does from
 * the press until the build is in front -- the build, its progress, the
 * proposal read again, the canvas taking the new build, the code check after
 * it. What it cannot cover is a build whose CODE differs from the page's:
 * that is `BuildCode`, driven headlessly in
 * `scenarios/src/codeModeBuild.scenario.test.ts`.
 *
 * "Reloaded" is read at the browser's boundary: a navigation of the main
 * frame, and a value set on the Studio's `window` that a reload would lose.
 */
test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

// The first test compiles the Studio and the page for this server.
test.setTimeout(240_000);

test.beforeEach(async () => {
  await mock.reset();
  await mock.proposal(MOCK_PROPOSAL);
  await mock.quickPreviews({ delayMs: 300 });
  await mock.serverBuilds({ delayMs: 1_500 });
});

test("Build after a coding session builds the proposal without reloading the Studio", async ({
  page,
}) => {
  await arriveInCodeMode(page);
  const studio = page.locator("#val-shadow-root");

  // The coding session.
  await mock.aiScript({
    steps: [
      {
        type: "tool",
        name: "write_files",
        arguments: {
          files: {
            "src/components/sections/HeroSection.tsx": `export default function HeroSection() {\n  return <section className="bg-black text-white"><h1>Dette er så gøy</h1></section>;\n}\n`,
          },
          message: "A darker hero",
        },
      },
    ],
    response: "Done.",
  });
  await send(page, "Make the hero dark");
  const [write] = await toolCalls(1);
  expect(write.isError, JSON.stringify(write.result)).toBe(false);

  // The preview is behind the staged code: the main button builds.
  const build = studio.getByRole("button", { name: /^Save/ }).first();
  await expect(build).toHaveAttribute(
    "title",
    "The preview is behind the latest changes. Press to update it.",
    { timeout: 30_000 },
  );

  const reloads = await watchForReload(page);
  await build.click();

  // Val Build built it...
  await expect
    .poll(async () => (await mock.serverBuildsMade()).length, {
      timeout: 60_000,
      message: "Val Build was never asked to build the proposal",
    })
    .toBe(1);
  // ...and the Studio says so, in the page it was pressed in.
  await expect(
    page.getByText("Built: the preview shows the change"),
  ).toBeVisible({ timeout: 60_000 });
  // Past the grace after which a Studio that cannot take a build in place
  // reloads (`STUDIO_RELOAD_GRACE_MS`, 3 s), with the poll's round trip.
  await page.waitForTimeout(8_000);

  expect(await reloads()).toEqual([]);
  // Built, with nothing left to save: the one step left is the main button.
  await expect(
    studio.getByRole("button", { name: /^Publish/ }).first(),
  ).toHaveAttribute("title", "Publishes the proposal to the site");
});

/** The `@valbuild/core` this Studio runs: what a build's registry has to be of. */
const CORE_VERSION: string = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "packages/core/package.json"),
    "utf8",
  ),
).version;

function manifestModules(json: unknown): Record<string, { schema: string }> {
  return Object(Reflect.get(Object(json), "modules"));
}

/**
 * The same session, and the build's manifest as the platform answers it at
 * the address once the build lands: a module's schema is the build's (the
 * session changed a `.val.ts`, which a Studio that builds on Val Build has
 * not evaluated -- `canBuildHere` is false there, so `studioStagedCodeDeps`
 * has no bundler), and its registry is named but not on the site, which is
 * what `@valbuild/tanstack-build` leaves for Val modules it cannot bundle for
 * the browser (`valModulesEntry`). `architecture/quirks.md` names that 404 as
 * the reason a hosted Studio reloads after a deploy.
 *
 * With nothing else left, the Studio reloads its page
 * (`BuildCode.scheduleReload`): the last resort, which is allowed. What this
 * holds is that it IS the last one -- the build's code was asked for first,
 * and the page reloaded once, after that and never before.
 */
test("Build whose code the Studio cannot import in place reloads the Studio once, as the last resort", async ({
  page,
}) => {
  let built = false;
  await page.route("**/api/val/manifest**", async (route) => {
    // Once built, always the whole answer: the Studio's ETag names a
    // manifest the build would not have answered.
    const headers = { ...route.request().headers() };
    if (built) delete headers["if-none-match"];
    const response = await route.fetch({ headers });
    if (!built || response.status() !== 200) {
      return route.fulfill({ response });
    }
    const json: unknown = await response.json();
    const modules = manifestModules(json);
    const [first] = Object.keys(modules);
    await route.fulfill({
      response,
      json: {
        ...Object(json),
        modules: {
          ...modules,
          [first]: { ...modules[first], schema: "the-schema-of-the-build" },
        },
        registry: {
          entry: "/_app/val-modules-e2e-proposal-build.js",
          core: CORE_VERSION,
        },
      },
    });
  });
  const missingEntry = page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname === "/_app/val-modules-e2e-proposal-build.js",
    { timeout: 120_000 },
  );

  await arriveInCodeMode(page);
  const studio = page.locator("#val-shadow-root");
  await mock.aiScript({
    steps: [
      {
        type: "tool",
        name: "write_files",
        arguments: {
          files: {
            "src/components/sections/HeroSection.tsx": `export default function HeroSection() {\n  return <section className="bg-black text-white"><h1>Dette er så gøy</h1></section>;\n}\n`,
          },
          message: "A darker hero",
        },
      },
    ],
    response: "Done.",
  });
  await send(page, "Make the hero dark");
  const [write] = await toolCalls(1);
  expect(write.isError, JSON.stringify(write.result)).toBe(false);

  const build = studio.getByRole("button", { name: /^Save/ }).first();
  await expect(build).toHaveAttribute(
    "title",
    "The preview is behind the latest changes. Press to update it.",
    { timeout: 30_000 },
  );
  /** What happened, in order: the build's code asked for, and reloads. */
  const happened: string[] = [];
  page.on("response", (res) => {
    if (
      new URL(res.url()).pathname === "/_app/val-modules-e2e-proposal-build.js"
    ) {
      happened.push(`registry ${res.status()}`);
    }
  });
  page.on("domcontentloaded", () => happened.push("reload"));
  await build.click();
  await expect(
    page.getByText("Built: the preview shows the change"),
  ).toBeVisible({ timeout: 60_000 });
  // Nothing reloaded for the build itself.
  expect(happened).toEqual([]);
  built = true;
  // What the canvas does when a page of a newer build loads in it: read the
  // manifest now (`checkCodeNow`), rather than at the next `/stat`.
  await page.evaluate(() => {
    const stores: unknown = Reflect.get(window, "__VAL_STORES__");
    const system: unknown = Reflect.get(Object(stores), "system");
    const check: unknown = Reflect.get(Object(system), "checkCodeNow");
    if (typeof check !== "function") throw new Error("no checkCodeNow");
    check.call(system);
  });
  // The Studio tried the build's code, and it was not there...
  expect((await missingEntry).status()).toBe(404);
  // ...so, past the grace (`STUDIO_RELOAD_GRACE_MS`, 3 s), the page
  // reloaded: once, and after the build's code was asked for.
  await expect
    .poll(() => happened.includes("reload"), {
      timeout: 30_000,
      message: "the Studio never fell back to reloading",
    })
    .toBe(true);
  // The reloaded Studio, on the same rewritten manifest, asks for the code
  // again; it must not reload again for it.
  await page.waitForTimeout(8_000);
  expect(happened.filter((event) => event === "reload")).toEqual(["reload"]);
  expect(happened[0]).toBe("registry 404");
});
