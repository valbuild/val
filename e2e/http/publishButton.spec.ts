import { expect, type Page, test } from "@playwright/test";
import { mock, openHttpStudio, sessionCookie, writePatch } from "./httpMode";

/**
 * The Publish button, pressed, in the mode where a publish is a commit.
 *
 * The rest of this directory publishes through `publishAll`, which calls the
 * store system with a message it chose — so none of it can see what the
 * BUTTON commits. That is the part here: by default a press publishes with no
 * box at all, and the message is the AI's where one answers and one naming
 * the exact changed path where none does. Only a project whose settings say
 * `studio.commitMessage: "required"` is asked for one.
 *
 * Asserted on the commit the content service received, because that is the
 * only place the message ends up: a box that showed the right text and a
 * commit that carried another is the bug this flow has had before.
 */

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
  await mock.aiOffline(false);
});

test.afterAll(async () => {
  await mock.aiOffline(false);
});

function studio(page: Page) {
  return page.locator("#val-shadow-root");
}

function publishButton(page: Page) {
  return studio(page).locator('[data-val-tour="publish"]').getByRole("button");
}

async function committedMessages(): Promise<(string | null)[]> {
  return (await mock.state()).commits.map((commit) => commit.commitMessage);
}

async function editTeddy(page: Page) {
  await writePatch(page, "/content/authors.val.ts", [
    { op: "replace", path: ["teddy", "name"], value: "Pressed, not typed" },
  ]);
}

test.describe("the Publish button in http mode", () => {
  test("publishes with the AI's message, and asks for nothing", async ({
    page,
  }) => {
    await mock.aiScript({
      steps: [],
      response: "Rename Theodor on the authors page",
    });
    await openHttpStudio(page);
    await editTeddy(page);

    await expect(publishButton(page)).toBeEnabled({ timeout: 30_000 });
    await publishButton(page).click();

    await expect
      .poll(committedMessages, {
        timeout: 30_000,
        message: "the press never produced a commit",
      })
      .toEqual(["Rename Theodor on the authors page"]);
    // No box was put in the way.
    await expect(
      studio(page).getByRole("textbox", { name: "Commit message" }),
    ).toHaveCount(0);
    // And the AI was given the change, not asked about nothing.
    const prompts = (await mock.aiState()).prompts.map((p) => p.text);
    expect(prompts.some((text) => text.includes("Pressed, not typed"))).toBe(
      true,
    );
  });

  test("without AI, the message names the exact path", async ({ page }) => {
    await mock.aiOffline(true);
    await openHttpStudio(page);
    await editTeddy(page);

    await expect(publishButton(page)).toBeEnabled({ timeout: 30_000 });
    await publishButton(page).click();

    await expect
      .poll(committedMessages, { timeout: 30_000 })
      .toEqual(["Update teddy.name in /content/authors.val.ts"]);
  });

  test("a project that requires a message gets the box, filled by the AI", async ({
    page,
  }) => {
    await openHttpStudio(page);
    await writePatch(page, "/settings.val.ts", [
      { op: "add", path: ["studio"], value: { commitMessage: "required" } },
    ]);
    await editTeddy(page);
    // Queued after the edits and before the press: the box asks when it opens.
    await mock.aiScript({ steps: [], response: "Require commit messages" });

    await expect(publishButton(page)).toBeEnabled({ timeout: 30_000 });
    await publishButton(page).click();

    const box = studio(page).getByRole("textbox", { name: "Commit message" });
    await expect(box).toHaveValue("Require commit messages", {
      timeout: 30_000,
    });
    // Filled is not published: a person presses Publish.
    expect(await committedMessages()).toEqual([]);

    await box.fill("Require a message on every publish");
    await studio(page)
      .getByRole("dialog")
      .getByRole("button", { name: /publish/i })
      .click();
    await expect
      .poll(committedMessages, { timeout: 30_000 })
      .toEqual(["Require a message on every publish"]);
  });
});
