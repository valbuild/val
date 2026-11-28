import { expect, test } from "@playwright/test";
import { MOCK_PROPOSAL } from "../http/config";
import {
  BUTTON_FILE,
  darkHero,
  HERO_FILE,
  ROUTE_FILE,
  siteCode,
} from "./codeModeSite";
import {
  answered,
  arriveInCodeMode,
  logLines,
  mock,
  quickPreviewInFront,
  sessionCookie,
  turn,
  watchForReload,
} from "./codeModeStudio";

/**
 * Simple code-mode tasks in a real browser, as the assistant does them:
 * find the code (`search_code`), read it (`read_file`), change it
 * (`edit_file`, `write_files`), look at the result in the preview
 * (`quick_preview`, `read_page`, `read_page_log` -- the page check's tools),
 * and Build.
 *
 * The model is not here. Each task is a scripted turn of the mock's
 * assistant: the tool calls a model makes for the task, with the arguments
 * it would send, run by the Studio exactly as it runs a model's. What is
 * asserted is what the tools answered, and what the Studio and the page
 * then did -- never what a model would make of it. The same tasks run
 * headlessly in `scenarios/src/codeModeTasks.scenario.test.ts`; what only
 * a browser has is the canvas, the quick preview's document and its log.
 *
 * The site's code (`codeModeSite.ts`) is what the mock says the live build
 * was made of, which is what the code tools read. The page in the canvas is
 * the example app's own home page, and Val Build's quick preview (the mock)
 * bundles nothing: so these hold what the tools and the Studio do with a
 * change, not that the change is drawn.
 */
test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

// The first test compiles the Studio and the page for this server.
test.setTimeout(240_000);

test.beforeEach(async () => {
  await mock.reset();
  await mock.proposal(MOCK_PROPOSAL);
  await mock.projectSource(siteCode);
  await mock.quickPreviews({ delayMs: 300 });
  await mock.serverBuilds({ delayMs: 1_500 });
});

/** "Make the hero dark": find it, read it, change it, read it back. */
const DARK_HERO = [
  { name: "search_code", arguments: { query: "bg-white", prefix: "src/" } },
  { name: "read_file", arguments: { path: HERO_FILE, offset: 10, limit: 3 } },
  {
    name: "edit_file",
    arguments: { path: HERO_FILE, ...darkHero, message: "A darker hero" },
  },
  { name: "read_file", arguments: { path: HERO_FILE } },
];

test("make the hero dark: search, read, edit, then look at it in a quick preview", async ({
  page,
}) => {
  await arriveInCodeMode(page);

  const calls = await turn(page, "Make the hero dark", [
    ...DARK_HERO,
    { name: "quick_preview" },
    { name: "read_page" },
    { name: "read_page_log", arguments: { levels: ["error"] } },
  ]);
  const [search, readPart, edit, readBack, quick, read, log] = calls;

  // Found where a person would look...
  expect(answered(search).matches).toEqual([
    {
      path: HERO_FILE,
      line: 11,
      text: `<section className="bg-white text-black py-24">`,
    },
  ]);
  // ...read exactly as edit_file needs it...
  expect(answered(readPart).text).toContain(darkHero.old_string);
  // ...changed, and staged in the proposal.
  answered(edit);
  expect(answered(readBack).text).toContain(darkHero.new_string);
  expect(answered(readBack).staged).toBe(true);
  const files = await page.evaluate(async (name) => {
    const res = await fetch(`/api/val/proposals-api/${name}/files`);
    return (await res.json()) as { staged: { files: string[] } };
  }, MOCK_PROPOSAL);
  expect(files.staged.files).toEqual([HERO_FILE]);

  // The quick preview, in front: what the page check reads.
  answered(quick);
  await quickPreviewInFront(page);
  expect(answered(read)).toMatchObject({ success: true });
  // And nothing went wrong on the page that the change did not do. Fails
  // today: the quick preview's own hydration failure (React #418).
  expect(logLines(log)).toEqual([]);
});

test("make the hero dark, then Build: built, and the Studio is not reloaded", async ({
  page,
}) => {
  await arriveInCodeMode(page);
  const studio = page.locator("#val-shadow-root");
  const calls = await turn(page, "Make the hero dark", DARK_HERO);
  for (const call of calls) answered(call);

  const build = studio.getByRole("button", { name: /^Save/ }).first();
  await expect(build).toHaveAttribute(
    "title",
    "The preview is behind the latest changes. Press to update it.",
    { timeout: 30_000 },
  );
  const reloads = await watchForReload(page);
  await build.click();
  await expect
    .poll(async () => (await mock.serverBuildsMade()).length, {
      timeout: 60_000,
      message: "Val Build was never asked to build the proposal",
    })
    .toBe(1);
  await expect(
    page.getByText("Built: the preview shows the change"),
  ).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(8_000);

  expect(await reloads()).toEqual([]);
  // Built, with nothing left to save: the one step left is the main button.
  await expect(
    studio.getByRole("button", { name: /^Publish/ }).first(),
  ).toHaveAttribute("title", "Publishes the proposal to the site");
});

test("add a section: a new component, the route rendering it, a quick preview, and Build", async ({
  page,
}) => {
  await arriveInCodeMode(page);
  const studio = page.locator("#val-shadow-root");
  const SECTION = "src/components/sections/Contact.tsx";

  const calls = await turn(page, "Add a contact section under the hero", [
    { name: "list_files", arguments: { prefix: "src/components/" } },
    { name: "read_file", arguments: { path: ROUTE_FILE } },
    {
      name: "write_files",
      arguments: {
        files: {
          [SECTION]: `export default function Contact() {\n  return <section className="py-16"><h2>Ta kontakt</h2></section>;\n}\n`,
        },
        message: "A contact section",
      },
    },
    {
      name: "edit_file",
      arguments: {
        path: ROUTE_FILE,
        old_string: `import HeroSection from "../components/sections/HeroSection";`,
        new_string: `import HeroSection from "../components/sections/HeroSection";\nimport Contact from "../components/sections/Contact";`,
      },
    },
    {
      name: "edit_file",
      arguments: {
        path: ROUTE_FILE,
        old_string: `      />\n    </main>`,
        new_string: `      />\n      <Contact />\n    </main>`,
      },
    },
    { name: "search_code", arguments: { query: "<Contact />" } },
    { name: "lint" },
    { name: "quick_preview" },
  ]);
  const [list, readRoute, write, importIt, renderIt, search, lint, quick] =
    calls;

  expect(JSON.stringify(answered(list))).toContain(HERO_FILE);
  expect(JSON.stringify(answered(list))).toContain(BUTTON_FILE);
  expect(answered(readRoute).text).toBe(siteCode[ROUTE_FILE]);
  answered(write);
  answered(importIt);
  answered(renderIt);
  expect(answered(search).matches).toEqual([
    expect.objectContaining({ path: ROUTE_FILE }),
  ]);
  answered(lint);
  answered(quick);
  await quickPreviewInFront(page);

  const build = studio.getByRole("button", { name: /^Save/ }).first();
  await expect(build).toHaveAttribute(
    "title",
    "The preview is behind the latest changes. Press to update it.",
    { timeout: 30_000 },
  );
  const reloads = await watchForReload(page);
  await build.click();
  await expect(
    page.getByText("Built: the preview shows the change"),
  ).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(8_000);
  expect(await reloads()).toEqual([]);
});
