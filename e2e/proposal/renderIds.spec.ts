import { expect, test } from "@playwright/test";
import { MOCK_PROPOSAL } from "../http/config";
import { HERO_FILE, darkHero, heroSection, siteCode } from "./codeModeSite";
import { edited } from "./codeModeCases";
import {
  answered,
  arriveInCodeMode,
  mock,
  sessionCookie,
  turn,
} from "./codeModeStudio";

/**
 * Render ids, in a real Studio and page (`proposals/renders.ts`,
 * `renderMark.ts`): a tool that changes the page answers with one, the page
 * in the canvas writes it on itself once it shows the change, and
 * `read_page` with `at` reads the page only then -- so the assistant never
 * judges the page from before its change.
 *
 * The scripted turn passes the id on as a model would (`{{renderId}}`: the
 * mock fills in the last one the turn's tools answered with).
 *
 * The mock's quick preview builds nothing (the canvas keeps showing the
 * example's own page), so what this holds is the plumbing: the id is minted,
 * reaches the page, is written there, and is read back. That the change is
 * on the page is the catalogue's, once the mock builds.
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
});

test("read_page at a quick preview's render id reads the page once it shows it", async ({
  page,
}) => {
  await arriveInCodeMode(page);

  const calls = await turn(page, "Make the hero dark, and look", [
    {
      name: "write_files",
      arguments: {
        files: {
          [HERO_FILE]: edited(
            heroSection,
            darkHero.old_string,
            darkHero.new_string,
          ),
        },
        message: "A darker hero",
      },
    },
    { name: "quick_preview" },
    { name: "read_page", arguments: { at: "{{renderId}}" } },
  ]);
  const [write, preview, read] = calls.map(answered);

  // Each change answers with an id of its own, the later one later.
  expect(typeof write.renderId).toBe("string");
  expect(typeof preview.renderId).toBe("string");
  expect(preview.renderId).not.toBe(write.renderId);
  // The page was read once it said it shows the quick preview.
  expect(read.success).toBe(true);
  expect(read.renderId).toBe(preview.renderId);
  // What the turn sent: the quick preview's id, filled in.
  expect(calls[2]?.arguments).toEqual({ at: preview.renderId });
});

test("read_page at an id the page never shows says so, and does not read the page before it", async ({
  page,
}) => {
  await arriveInCodeMode(page);

  const [read] = await turn(page, "Look at a change that is not there", [
    {
      name: "read_page",
      arguments: { at: "r-zzzzzzzzz-1", timeout_ms: 3_000 },
    },
  ]);
  expect(read?.isError).toBe(true);
  expect(JSON.stringify(read?.result)).toContain("does not show r-zzzzzzzzz-1");
});
