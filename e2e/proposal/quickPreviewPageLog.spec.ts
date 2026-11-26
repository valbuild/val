import { expect, test, type Page } from "@playwright/test";
import { MOCK_PROPOSAL } from "../http/config";
import {
  canvasFrames,
  mock,
  openCodeMode,
  quickPreviewInFront,
  sessionCookie,
} from "./codeModeStudio";
import { send, toolCalls } from "../http/assistant";

/**
 * The page check's "React #418" on every change in code mode.
 *
 * Reported: each page check failed on "one uncaught error, React minified
 * error #418 (hydration mismatch, HTML text differing between server and
 * client)", which it could not place and handed to the assistant to fix.
 *
 * The page it reads after a change is a quick preview: the last build's HTML
 * run by the new code. The new code used to hydrate it after the server's
 * markup was taken out, and React reported the emptied body as a hydration
 * failure, which the page log kept as an uncaught error of the page's. Now
 * `ValProvider` renders the site with the new code without hydrating it
 * (`QuickPreviewRender`). Headlessly:
 * `packages/tanstack/src/quickPreviewHydration.test.tsx`.
 *
 * Here in a real browser, the page check's way: a change is written (the
 * mock's scripted turn, no model), its quick preview comes to the front of
 * the canvas, and the assistant's `read_page_log` -- the tool the page check
 * reads the page with -- is asked what went wrong on it. The page is the
 * showcase's home page, which logs nothing of its own on a normal load (the
 * last test says so, so a failure of the first is not the page's).
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

/**
 * The errors `read_page_log` answers for the page in the canvas: asked by a
 * scripted turn, run by the Studio as it runs the page check's.
 */
async function pageLogErrors(page: Page, turns: number): Promise<string[]> {
  await mock.aiScript({
    steps: [
      { type: "tool", name: "read_page_log", arguments: { levels: ["error"] } },
    ],
    response: "Read.",
  });
  await send(page, "What went wrong on the page?");
  const calls = await toolCalls(turns);
  const read = calls[calls.length - 1];
  expect(read.name).toBe("read_page_log");
  expect(read.isError, JSON.stringify(read.result)).toBe(false);
  const entries: unknown = Reflect.get(Object(read.result), "entries");
  if (!Array.isArray(entries)) {
    throw new Error(
      `read_page_log answered no entries: ${JSON.stringify(read.result)}`,
    );
  }
  return entries.map(
    (entry) =>
      `${String(Reflect.get(Object(entry), "source"))}: ${
        String(Reflect.get(Object(entry), "text")).split("\n")[0]
      }`,
  );
}

test("a change's quick preview logs no error the page did not make", async ({
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
  await send(page, "Make the hero dark");
  const [write] = await toolCalls(1);
  expect(write.isError, JSON.stringify(write.result)).toBe(false);

  // The change's quick preview, alone in front: what the page check reads.
  await expect
    .poll(async () => (await mock.quickPreviewsMade()).length, {
      timeout: 30_000,
      message: "no quick preview was made once the turn ended",
    })
    .toBe(1);
  await quickPreviewInFront(page);

  expect(await pageLogErrors(page, 2)).toEqual([]);
});

test("the same page, not as a quick preview, logs no error", async ({
  page,
}) => {
  await openCodeMode(page);
  await expect(canvasFrames(page)).toHaveCount(1);
  expect(
    (await canvasFrames(page).first().getAttribute("src")) ?? "",
  ).not.toContain("val_quick=");

  expect(await pageLogErrors(page, 1)).toEqual([]);
});
