import { expect, test } from "@playwright/test";
import { MOCK_PROPOSAL } from "../http/config";
import { send, toolCalls } from "../http/assistant";
import { mock, openCodeMode, sessionCookie } from "./codeModeStudio";

/**
 * The page check does not take the chat's scripted turns (G1 in
 * `docs/handoff/code-mode-test-rig-plan.md`).
 *
 * After a turn that changes code, the Studio starts a page check by itself
 * (`usePageCheckSession`): a HIDDEN prompt on the same assistant socket. The
 * mock used to answer every prompt with the next queued script, so the page
 * check ran whatever turn a test had queued for the chat, and the chat's
 * next message found nothing queued. A test that queued its next turn before
 * the check started lost it -- which is a race, and how
 * `quickPreviewPageLog.spec.ts` failed once in CI.
 *
 * Here both chat turns are queued before the first is sent, so the page
 * check, which starts when the first turn ends, runs while the second is in
 * the queue. The second message has to get its own turn.
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
});

test("a page check started by a change does not take the chat's next turn", async ({
  page,
}) => {
  await openCodeMode(page);

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
  await mock.aiScript({
    steps: [
      {
        type: "tool",
        name: "read_file",
        arguments: { path: "src/components/sections/HeroSection.tsx" },
      },
    ],
    response: "Read it.",
  });

  await send(page, "Make the hero dark");
  const [write] = await toolCalls(1);
  expect(write.isError, JSON.stringify(write.result)).toBe(false);

  // The page check the change started: a hidden prompt of its own.
  await expect
    .poll(
      async () =>
        (await mock.aiState()).prompts.filter((prompt) => prompt.hidden).length,
      { timeout: 120_000, message: "no page check was started" },
    )
    .toBeGreaterThan(0);

  await send(page, "Show me the hero's file");
  // The chat's own calls: the page check's, if it ran any, are not the chat's.
  await expect
    .poll(
      async () =>
        (await mock.aiState()).toolCalls
          .filter((call) => !call.hidden)
          .map((call) => call.name),
      {
        timeout: 60_000,
        message: "the chat's second turn did not run its own script",
      },
    )
    .toEqual(["write_files", "read_file"]);
  // And the page check did not run the chat's turn.
  expect(
    (await mock.aiState()).toolCalls
      .filter((call) => call.hidden)
      .map((call) => call.name),
  ).not.toContain("read_file");
});
