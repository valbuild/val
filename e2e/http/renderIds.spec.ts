import { expect, test, type Page } from "@playwright/test";
import { mock, sessionCookie } from "./httpMode";
import { send, toolCalls } from "./assistant";

/**
 * A content edit's render id, in a real Studio and page
 * (`proposals/renders.ts`): `create_patch` answers with one, the page in the
 * canvas writes it on itself once it shows the edit -- once the server holds
 * it and the page's loaders have re-read it (`refreshLoop.shown`) -- and
 * `read_page` with `at` reads the page only then. Read without `at`, the
 * page can still be the one from before the edit; read with it, the edit is
 * on it.
 *
 * The scripted turn passes the id on as a model would (`{{renderId}}`: the
 * mock fills in the last one the turn's tools answered with).
 */
test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
  viewport: { width: 1600, height: 1000 },
});

test.beforeEach(async () => {
  await mock.reset();
});

/** The Studio on the home page, with the canvas open. */
const STUDIO_ON_HOME =
  "/val/~/src/routes/_site.index.val.ts?p=%22%2F%22&canvas=1";
const MODULE = "/src/routes/_site.index.val.ts";

async function openWithCanvasAndChat(page: Page): Promise<void> {
  await page.goto(STUDIO_ON_HOME);
  await expect(
    page
      .locator("#val-shadow-root")
      .getByRole("status")
      .filter({ hasText: /preview|no answer/i }),
    "the canvas never went live",
  ).toHaveCount(0, { timeout: 120_000 });
  await page
    .locator("#val-shadow-root")
    .getByRole("button", { name: "AI assistant" })
    .click();
}

test("read_page at an edit's render id reads the page with the edit on it", async ({
  page,
}) => {
  await openWithCanvasAndChat(page);
  const title = `Made by the assistant ${Date.now()}`;
  await mock.aiScript({
    steps: [
      {
        type: "tool",
        name: "create_patch",
        arguments: {
          module_file_path: MODULE,
          patch: [
            { op: "replace", path: ["/", "hero", "title"], value: title },
          ],
        },
      },
      { type: "tool", name: "read_page", arguments: { at: "{{renderId}}" } },
    ],
    response: "Done.",
  });
  await send(page, "Retitle the home page");
  const [write, read] = await toolCalls(2);
  expect(write?.isError, JSON.stringify(write?.result)).toBe(false);
  expect(read?.isError, JSON.stringify(read?.result)).toBe(false);
  const renderId: unknown = Reflect.get(Object(write?.result), "renderId");
  expect(typeof renderId).toBe("string");
  expect(Reflect.get(Object(read?.result), "renderId")).toBe(renderId);
  // The page it read is the page with the edit.
  expect(
    JSON.stringify(Reflect.get(Object(read?.result), "outline")),
  ).toContain(title);
});
