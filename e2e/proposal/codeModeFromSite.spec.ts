import { expect, test, type Page } from "@playwright/test";
import { MOCK_PROPOSAL, PROPOSAL_APP_PORT } from "../http/config";
import { mock, openHttpStudio, sessionCookie } from "../http/httpMode";
import { composer, send } from "../http/assistant";
import { chatOnScreen, expectTurnShown, runningOnScreen } from "./chatTurns";

/**
 * A chat on the site that asks for code mode, gone on with in the proposal
 * code mode opens.
 *
 * What a person reported: on the site, the assistant asked for code mode,
 * they pressed the card's button, and the Studio moved to the site-code
 * proposal with the chat (`?session=`). There the earlier messages were
 * shown, without their tools, nothing could be sent, and nothing showed
 * progress.
 *
 * The press answers the card and leaves the site at once, so the turn that
 * asked is still running when the site's Studio goes -- the service stops it
 * when that socket closes. What the proposal's Studio must do with the chat
 * it is handed is what any chat must do: show a turn the service still runs
 * in it ({@link expectTurnShown}), and once none runs, answer the next
 * message.
 *
 * Two apps on one mock: the site's (`chromium-http`'s app, which this
 * project starts too) and the proposal's, at the address the mock says the
 * site-code proposal is served at. One sign-in serves both: same project,
 * same host.
 */
test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

// Both Studios compile on first use.
test.setTimeout(300_000);

const PROPOSAL_ADDRESS = `http://localhost:${PROPOSAL_APP_PORT}`;

test.beforeEach(async () => {
  await mock.reset();
  await mock.proposal(MOCK_PROPOSAL);
  await mock.siteCode(MOCK_PROPOSAL, PROPOSAL_ADDRESS);
});

function studioOf(page: Page) {
  return page.locator("#val-shadow-root");
}

/** Open the assistant, unless it is open already. */
async function openAssistant(page: Page): Promise<void> {
  const studio = studioOf(page);
  const editor = studio.locator(
    '.val-chat-editor-content .ProseMirror[contenteditable="true"]',
  );
  if (!(await editor.isVisible())) {
    await studio.getByRole("button", { name: "AI assistant" }).first().click();
  }
  await composer(page);
}

test("a chat that asked for code mode on the site goes on in the proposal it opens", async ({
  page,
}) => {
  await openHttpStudio(page);
  await openAssistant(page);

  await mock.aiScript({
    steps: [
      {
        type: "tool",
        name: "request_code_mode",
        arguments: {
          reason:
            "To add a testimonials section, the page needs a new component.",
        },
        timeoutMs: null,
      },
      // The model, writing its reply to the press.
      { type: "pause", ms: 3_000 },
    ],
    response: "Code mode is opening. Ask me again there.",
  });
  await send(page, "Add a testimonials section");
  const studio = studioOf(page);
  const card = studio.getByRole("group", {
    name: "The assistant asks for code mode",
  });
  await expect(card).toBeVisible({ timeout: 30_000 });
  const chat = chatOnScreen(page);
  expect(chat, "the chat was never given an id").not.toBeNull();

  // The card's button: the site's code mode, in the site-code proposal.
  await card.getByRole("button", { name: "Turn on code mode" }).click();
  await page.waitForURL((url) => url.port === String(PROPOSAL_APP_PORT), {
    timeout: 120_000,
  });
  // The same chat, carried in the address.
  expect(chatOnScreen(page)).toBe(chat);

  await openAssistant(page);
  await expect(studio.getByText("Add a testimonials section")).toBeVisible({
    timeout: 60_000,
  });
  await expectTurnShown(page, mock);
  await expect
    .poll(async () => (await runningOnScreen(page, mock)) === null, {
      timeout: 30_000,
      message: "the turn the site asked never ended",
    })
    .toBe(true);

  await mock.aiScript({ steps: [], response: "Here is the section." });
  await send(page, "Go on");
  await expect(studio.getByText("Here is the section.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(studio.getByText("Someone else is asking")).toHaveCount(0);
});
