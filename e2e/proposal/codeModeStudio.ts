import { expect, type Page } from "@playwright/test";
import { MOCK_PROPOSAL } from "../http/config";
import {
  httpTarget,
  PROPOSAL_APP,
  type MockAiToolCall,
} from "../http/httpMode";
import { send, toolCalls } from "../http/assistant";

/**
 * The Studio in code mode at a proposal's address, and the page in its
 * canvas, for the specs under `e2e/proposal/`: getting there, and reading
 * what the assistant's tools answered.
 */
export const { sessionCookie, openHttpStudio, mock } = httpTarget(PROPOSAL_APP);

/**
 * The Studio as `</>` on the site leaves it: at the proposal's address with
 * the parameter that asks for code mode (`withCodeModeParam`), the
 * assistant open, and the page in the canvas live.
 */
export async function arriveInCodeMode(page: Page): Promise<void> {
  await openHttpStudio(page, "/val?val_code_mode=on");
  const studio = page.locator("#val-shadow-root");
  // Acted on once the proposal's own read says code mode is off, and then
  // taken out of the address.
  await expect
    .poll(() => new URL(page.url()).searchParams.get("val_code_mode"), {
      timeout: 120_000,
      message: "the Studio never acted on ?val_code_mode=on",
    })
    .toBe(null);
  await studio.getByRole("button", { name: "AI assistant" }).first().click();
  /*
   * Live: the page answered, in preview mode, so it can take a quick
   * preview. The assistant's Select is enabled exactly while the canvas is
   * live, in code mode: see `codeModePreview.spec.ts`.
   */
  await expect(
    studio.getByRole("button", {
      name: "Point the assistant at something on the page",
    }),
  ).toBeEnabled({ timeout: 120_000 });
}

/** Code mode turned on through the API, then the Studio and its canvas. */
export async function openCodeMode(page: Page): Promise<void> {
  const on = await page.request.post(
    `/api/val/proposals-api/${MOCK_PROPOSAL}/code-mode`,
    { data: { on: true } },
  );
  expect(on.ok(), await on.text()).toBe(true);
  await openHttpStudio(page);
  const studio = page.locator("#val-shadow-root");
  await studio.getByRole("button", { name: "AI assistant" }).first().click();
  await expect(
    studio.getByRole("button", {
      name: "Point the assistant at something on the page",
    }),
  ).toBeEnabled({ timeout: 120_000 });
}

/** The canvas's frames. */
export function canvasFrames(page: Page) {
  return page
    .locator("#val-shadow-root")
    .locator('[data-val-tour="canvas"] iframe');
}

/** The canvas shows a quick preview, and only it. */
export async function quickPreviewInFront(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        (await canvasFrames(page).count()) === 1 &&
        ((await canvasFrames(page).first().getAttribute("src")) ?? "").includes(
          "val_quick=",
        ),
      { timeout: 30_000, message: "the quick preview never came to the front" },
    )
    .toBe(true);
}

/**
 * One scripted turn of the assistant (no model): the tool calls a model
 * makes for a task, run by the Studio as it runs any. Answers the calls of
 * THIS turn, with what the Studio answered each.
 */
export async function turn(
  page: Page,
  prompt: string,
  steps: { name: string; arguments?: unknown }[],
): Promise<MockAiToolCall[]> {
  const before = (await mock.aiState()).toolCalls.length;
  await mock.aiScript({
    steps: steps.map((step) => ({ type: "tool" as const, ...step })),
    response: "Done.",
  });
  await send(page, prompt);
  return (await toolCalls(before + steps.length)).slice(before);
}

/** A tool call's answer, narrowed: it succeeded, and this is what it said. */
export function answered(call: MockAiToolCall): Record<string, unknown> {
  expect(
    call.isError ? `${call.name}: ${JSON.stringify(call.result)}` : "ok",
  ).toBe("ok");
  return Object(call.result);
}

/** A `read_page_log` answer's entries, one line each. */
export function logLines(call: MockAiToolCall): string[] {
  const entries: unknown = answered(call).entries;
  if (!Array.isArray(entries)) {
    throw new Error(`no entries: ${JSON.stringify(call.result)}`);
  }
  return entries.map(
    (entry) =>
      `${String(Reflect.get(Object(entry), "source"))}: ${
        String(Reflect.get(Object(entry), "text")).split("\n")[0]
      }`,
  );
}

/**
 * Watch for the Studio's page being reloaded: a new document in the main
 * frame, and a value set on its `window` that any reload loses. Not
 * `framenavigated`, which the Studio's own `history.replaceState` fires too.
 */
export async function watchForReload(
  page: Page,
): Promise<() => Promise<string[]>> {
  const documents: string[] = [];
  page.on("domcontentloaded", () => documents.push(page.url()));
  await page.evaluate(() => {
    Reflect.set(window, "__e2eSameDocument", true);
  });
  return async () => {
    const same = await page
      .evaluate(() => Reflect.get(window, "__e2eSameDocument") === true)
      .catch(() => false);
    return same ? documents : [...documents, "(the document was replaced)"];
  };
}
