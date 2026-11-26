import { expect, test, type Page } from "@playwright/test";
import { MOCK_PROPOSAL } from "../http/config";
import { httpTarget, PROPOSAL_APP } from "../http/httpMode";
import { composer, send } from "../http/assistant";
import { expectTurnShown, runningOnScreen } from "./chatTurns";

/**
 * A chat taken up again while its turn is running.
 *
 * What a person reported: they went on with a chat in a proposal, the
 * assistant asked for code mode, and from there the chat showed nothing
 * going on. Then it would not take a message at all, and the only way on
 * was a new chat.
 *
 * The content service runs one turn at a time in a chat, and gives the chat
 * back only when that turn ends: answered, stopped, or its tab gone. A turn
 * the Studio no longer shows is a turn nobody can answer or stop -- and when
 * it waits on the person (a question, a request for code mode) nothing else
 * ever ends it, so every message after it is refused as `session_busy`.
 *
 * So the rule each test checks, wherever the person goes in between
 * (`expectTurnShown` in `chatTurns.ts`): while the service runs a turn in the chat on
 * screen, the chat says so and can stop it, and what the turn waits on is
 * there to answer. And once that turn is over, the next message is answered.
 *
 * The mock content host plays the turns, under the service's rules (one turn
 * per chat, `session_busy`, stopped by `ai_cancel` or a closed socket); the
 * chat, its tools, the card and code mode are the product's.
 */
const { sessionCookie, openHttpStudio, mock } = httpTarget(PROPOSAL_APP);

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

// The first test compiles the Studio for this server.
test.setTimeout(240_000);

test.beforeEach(async () => {
  await mock.reset();
  await mock.proposal(MOCK_PROPOSAL);
});

const REASON = "To add a testimonials section, the page needs a new component.";

/**
 * A turn that names its chat, writes, thinks long enough for the person to
 * go somewhere else, and then asks for code mode -- which waits on the
 * person, as the real tool does (`REQUEST_CODE_MODE_TOOL`, `timeoutMs: null`).
 */
function askingForCodeMode(name: string) {
  return {
    steps: [
      {
        type: "tool" as const,
        name: "set_session_name",
        arguments: { name },
      },
      { type: "text" as const, text: "Let me look at the page first. " },
      { type: "pause" as const, ms: 5_000 },
      {
        type: "tool" as const,
        name: "request_code_mode",
        arguments: { reason: REASON },
        timeoutMs: null,
      },
    ],
    response: "Code mode is on, so I can add the section now.",
  };
}

function studioOf(page: Page) {
  return page.locator("#val-shadow-root");
}

/** The Studio at the proposal, code mode off, with the assistant open. */
async function openChat(page: Page): Promise<void> {
  await openHttpStudio(page);
  await studioOf(page)
    .getByRole("button", { name: "AI assistant" })
    .first()
    .click();
  await composer(page);
}

/** Open a chat from History, by the name its turn gave it. */
async function openFromHistory(page: Page, name: string): Promise<void> {
  const studio = studioOf(page);
  // The chat's own, which says so; the Studio's History is an icon.
  await studio
    .getByRole("button", { name: "History", exact: true })
    .filter({ hasText: "History" })
    .click();
  await studio.getByRole("button", { name, exact: true }).click();
}

/** The chat has been named, by the turn's `set_session_name`. */
async function waitForName(name: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (await mock.aiState()).sessions.some(
          (session) => session.name === name,
        ),
      { timeout: 30_000, message: `the chat was never named ${name}` },
    )
    .toBe(true);
}

/**
 * The end of every test: answer what the turn waits on, if it is still
 * running (stopping it when the person left would be as good), see it end,
 * and send one more message, which is answered -- not refused as
 * `session_busy`.
 */
async function finishAndAskAgain(page: Page): Promise<void> {
  const studio = studioOf(page);
  const running = await runningOnScreen(page, mock);
  if (running?.waitingOn?.name === "request_code_mode") {
    await studio
      .getByRole("group", { name: "The assistant asks for code mode" })
      .getByRole("button", { name: "Turn on code mode" })
      .click();
    await expect(
      studio.getByText("Code mode is on, so I can add the section now."),
    ).toBeVisible({ timeout: 30_000 });
  }
  await expect
    .poll(async () => (await runningOnScreen(page, mock)) === null, {
      timeout: 30_000,
      message: "the chat's turn never ended",
    })
    .toBe(true);

  await mock.aiScript({ steps: [], response: "Here is the section." });
  await send(page, "Thanks, go on");
  await expect(studio.getByText("Here is the section.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(studio.getByText("Someone else is asking")).toHaveCount(0);
}

test("a chat opened again from History while its turn runs still shows the turn, and its request for code mode", async ({
  page,
}) => {
  await openChat(page);
  await mock.aiScript(askingForCodeMode("Testimonials"));
  await send(page, "Add a testimonials section");
  await waitForName("Testimonials");
  await expectTurnShown(page, mock);

  // Going on with the chat: picked from History, mid-turn.
  await openFromHistory(page, "Testimonials");
  await expectTurnShown(page, mock);

  // The turn asks for code mode once it has thought.
  await expect
    .poll(async () => (await runningOnScreen(page, mock))?.waitingOn?.name, {
      timeout: 30_000,
    })
    .toBe("request_code_mode");
  await expectTurnShown(page, mock);

  await finishAndAskAgain(page);
});

test("a chat left for another while its turn runs, and opened again, still shows the turn", async ({
  page,
}) => {
  await openChat(page);
  await mock.aiScript({
    steps: [
      {
        type: "tool",
        name: "set_session_name",
        arguments: { name: "Prices" },
      },
    ],
    response: "The prices are up to date.",
  });
  await send(page, "Check the prices");
  await expect(
    studioOf(page).getByText("The prices are up to date."),
  ).toBeVisible({ timeout: 30_000 });

  await studioOf(page).getByRole("button", { name: "New chat" }).click();
  await mock.aiScript(askingForCodeMode("Testimonials"));
  await send(page, "Add a testimonials section");
  await waitForName("Testimonials");
  await expectTurnShown(page, mock);

  // Away to the other chat while this one's turn runs...
  await openFromHistory(page, "Prices");
  await expect(
    studioOf(page).getByText("The prices are up to date."),
  ).toBeVisible();
  // ...and back into it, by when it waits on the person -- or has ended,
  // if leaving it stopped it.
  await expect
    .poll(
      async () => {
        const { runningTurns } = await mock.aiState();
        return (
          runningTurns.length === 0 ||
          runningTurns.some(
            (turn) => turn.waitingOn?.name === "request_code_mode",
          )
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await openFromHistory(page, "Testimonials");
  await expectTurnShown(page, mock);

  await finishAndAskAgain(page);
});
