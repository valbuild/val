import { expect, test, type Page } from "@playwright/test";
import {
  HTTP_APP_PORT,
  MOCK_PROPOSAL,
  PROPOSAL_APP_PORT,
} from "../http/config";
import { openHttpStudio as openSiteStudio } from "../http/httpMode";
import { send } from "../http/assistant";
import { HERO_FILE, siteCode } from "./codeModeSite";
import { mock, sessionCookie } from "./codeModeStudio";

/**
 * From the site to code mode, in one conversation, with nothing in between
 * that looks broken.
 *
 * Someone on the site asks for a change to the code. The assistant asks for
 * code mode (`request_code_mode`), they accept, choose a proposal, and the
 * Studio opens it -- at its own address, a different page -- with code mode
 * on and the same conversation open. They wait for it to load, and carry on
 * where they were.
 *
 * What a person would notice, held from the first moment the proposal's
 * page draws:
 * - the conversation is the one they were in: what they wrote is there;
 * - it is never an EMPTY chat that then fills in (an empty chat says the
 *   conversation was lost, even if it comes back a second later);
 * - nothing that was shown disappears again while it loads;
 * - the next message works there, in code mode.
 *
 * The page is sampled every 50 ms from its first script (`addInitScript`),
 * so a flash of an empty chat is seen even if it lasts one frame or two.
 */
test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
  viewport: { width: 1600, height: 1000 },
});

// The first test compiles both Studios.
test.setTimeout(300_000);

test.beforeEach(async () => {
  await mock.reset();
  await mock.proposal(MOCK_PROPOSAL);
  // As home answers once the proposal's address is made: the proposal app.
  await mock.proposalAddress(
    MOCK_PROPOSAL,
    `http://localhost:${PROPOSAL_APP_PORT}`,
  );
  await mock.projectSource(siteCode);
  await mock.quickPreviews({ delayMs: 300 });
});

const ASKED = "Make the hero section dark";
const CONTINUED = "Now show me the hero's file";
/** What an empty chat offers: shown only when there is no conversation. */
const EMPTY_CHAT = "Summarize recent changes";

type Sample = { t: number; asked: boolean; empty: boolean; chat: boolean };

/** Sample the chat on every document from its first script. */
async function sampleChat(page: Page): Promise<void> {
  await page.addInitScript(
    ({ asked, empty }) => {
      const started = performance.now();
      const samples: unknown[] = [];
      Reflect.set(window, "__e2eChatSamples", samples);
      const sample = () => {
        const root = document.querySelector("#val-shadow-root")?.shadowRoot;
        const text = root?.textContent ?? "";
        samples.push({
          t: Math.round(performance.now() - started),
          chat: root?.querySelector(".val-chat-editor-content") != null,
          asked: text.includes(asked),
          empty: text.includes(empty),
        });
      };
      setInterval(sample, 50);
    },
    { asked: ASKED, empty: EMPTY_CHAT },
  );
}

async function samples(page: Page): Promise<Sample[]> {
  const got: unknown = await page.evaluate(() =>
    Reflect.get(window, "__e2eChatSamples"),
  );
  if (!Array.isArray(got)) return [];
  return got.map((s) => ({
    t: Number(Reflect.get(Object(s), "t")),
    asked: Reflect.get(Object(s), "asked") === true,
    empty: Reflect.get(Object(s), "empty") === true,
    chat: Reflect.get(Object(s), "chat") === true,
  }));
}

test("asked on the site, accepted, and carried on in the proposal: one conversation, never an empty chat", async ({
  page,
}) => {
  // On the site, the assistant open.
  // The site's own app: this project's base address is the proposal's.
  await openSiteStudio(page, `http://localhost:${HTTP_APP_PORT}/val`);
  const studio = page.locator("#val-shadow-root");
  await studio.getByRole("button", { name: "AI assistant" }).first().click();

  // The assistant asks for code mode, and waits for the answer.
  await mock.aiScript({
    steps: [
      {
        type: "tool",
        name: "request_code_mode",
        arguments: { reason: "The hero's colours are in its component." },
        timeoutMs: null,
      },
    ],
    response: "Open the proposal and I will carry on there.",
  });
  await send(page, ASKED);
  await studio.getByRole("button", { name: "Choose a proposal…" }).click();
  const session = new URL(page.url()).searchParams.get("session");
  expect(session, "the conversation is not in the address").not.toBeNull();

  // The proposal, chosen from the menu the card opened.
  await sampleChat(page);
  await studio
    .getByRole("menu", { name: "Open a proposal in code mode" })
    .getByRole("menuitem", { name: new RegExp(MOCK_PROPOSAL) })
    .click();
  await page.waitForURL(
    (url) =>
      url.port === String(PROPOSAL_APP_PORT) && url.pathname.startsWith("/val"),
    { timeout: 120_000 },
  );
  expect(new URL(page.url()).searchParams.get("session")).toBe(session);

  // Loaded: the conversation is back, and code mode is on.
  await expect(
    page.locator("#val-shadow-root").getByText(ASKED).first(),
    "the conversation did not come back in the proposal",
  ).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(() => new URL(page.url()).searchParams.get("val_code_mode"), {
      timeout: 120_000,
      message: "the proposal's Studio never turned code mode on",
    })
    .toBe(null);

  // How it got there: never an empty chat, and nothing shown then lost.
  const seen = await samples(page);
  const withChat = seen.filter((s) => s.chat);
  expect(withChat.length, "the chat never showed").toBeGreaterThan(0);
  expect(
    withChat.filter((s) => s.empty).map((s) => s.t),
    "an empty chat was shown while the conversation loaded",
  ).toEqual([]);
  const firstAsked = withChat.findIndex((s) => s.asked);
  expect(
    withChat
      .slice(firstAsked)
      .filter((s) => !s.asked)
      .map((s) => s.t),
    "the conversation was shown, then gone again",
  ).toEqual([]);

  // And it carries on there, in code mode.
  const before = (await mock.aiState()).toolCalls.filter(
    (call) => !call.hidden,
  ).length;
  await mock.aiScript({
    steps: [
      {
        type: "tool",
        name: "read_file",
        arguments: { path: HERO_FILE },
      },
    ],
    response: "Here it is.",
  });
  await send(page, CONTINUED);
  await expect
    .poll(
      async () =>
        (await mock.aiState()).toolCalls.filter((call) => !call.hidden).length,
      { timeout: 60_000, message: "the next turn did not run in the proposal" },
    )
    .toBe(before + 1);
  const read = (await mock.aiState()).toolCalls
    .filter((call) => !call.hidden)
    .at(-1);
  expect(read?.name).toBe("read_file");
  expect(read?.isError, JSON.stringify(read?.result)).toBe(false);
  // The prompt went to the same conversation.
  const prompts = (await mock.aiState()).prompts.filter((p) => !p.hidden);
  expect(prompts.at(-1)?.sessionId).toBe(session);
});
