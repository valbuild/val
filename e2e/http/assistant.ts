import { expect, type Locator, type Page } from "@playwright/test";
import { mock, openHttpStudio, type MockAiToolCall } from "./httpMode";

/**
 * Driving the assistant from a test: open it, send a prompt, attach an image,
 * and read back what its scripted turn did.
 *
 * The model is not present: `e2e/mock-content-host` plays the turn a test
 * scripts with `mock.aiScript`. See `aiChat.spec.ts` for why.
 */

/**
 * Open the Studio and the assistant panel.
 *
 * The assistant is a floating panel rather than a fixed column, so it is behind
 * the top bar's button and is not mounted until it is opened — which is also
 * when its socket is opened. Everything below therefore starts here rather than
 * with `openHttpStudio`.
 */
export async function openChatStudio(page: Page): Promise<void> {
  await openHttpStudio(page);
  await page
    .locator("#val-shadow-root")
    .getByRole("button", { name: "AI assistant" })
    .click();
}

/**
 * The chat's composer, once the assistant socket is up.
 *
 * The wait is the point: `AIChatEditor` is disabled until `/ai/initialize` has
 * answered and the socket has opened, and typing into a disabled ProseMirror
 * silently does nothing — which fails later, as an empty prompt, somewhere that
 * says nothing about the connection.
 *
 * Waited for POSITIVELY, on the editor becoming editable, rather than by watching
 * the "Connecting…" banner disappear: an absent element satisfies `toBeHidden`,
 * so a banner that has not rendered yet reads exactly like one that is gone.
 */
export async function composer(page: Page): Promise<Locator> {
  const editor = page
    .locator("#val-shadow-root")
    .locator('.val-chat-editor-content .ProseMirror[contenteditable="true"]');
  await expect(editor, "the assistant never connected").toBeVisible({
    timeout: 60_000,
  });
  return editor;
}

/** Type a prompt and send it. */
export async function send(page: Page, text: string): Promise<void> {
  const editor = await composer(page);
  await editor.click();
  await page.keyboard.type(text);
  await page
    .locator("#val-shadow-root")
    .getByRole("button", { name: "Send message" })
    .click();
}

/**
 * Attach an image to the chat and wait for the content service to have it.
 *
 * The upload is fire-and-forget as far as the composer is concerned and Send
 * stays enabled throughout, so without this wait a test can send a prompt whose
 * attachment has no key yet — and `sendMessage` drops attachments that are still
 * uploading, leaving the model with nothing to name.
 */
export async function attachImage(page: Page, file: string): Promise<void> {
  const studio = page.locator("#val-shadow-root");
  // `multiple` is what distinguishes the chat's picker from a gallery's.
  await studio.locator('input[type="file"][multiple]').setInputFiles(file);
  await expect
    .poll(async () => (await mock.aiState()).images.length, {
      timeout: 30_000,
      message: "the attached image never reached the content service",
    })
    .toBe(1);
}

/** Wait for the scripted turn to finish, and hand back what it recorded. */
export async function toolCalls(expected: number): Promise<MockAiToolCall[]> {
  await expect
    .poll(async () => (await mock.aiState()).toolCalls.length, {
      timeout: 60_000,
      message: "the assistant's tool calls never came back",
    })
    .toBe(expected);
  return (await mock.aiState()).toolCalls;
}

/** A successful tool result, narrowed so a test can read its patch id. */
export function okResult(call: MockAiToolCall): {
  success: true;
  patchId: string;
  filePath?: string;
} {
  expect(
    call.isError,
    `${call.name} failed: ${JSON.stringify(call.result)}`,
  ).toBe(false);
  const result = call.result as { success?: boolean; patchId?: string };
  expect(result.success, JSON.stringify(call.result)).toBe(true);
  expect(typeof result.patchId).toBe("string");
  return call.result as { success: true; patchId: string; filePath?: string };
}

/** The error message a failing tool result carried. */
export function errorMessage(call: MockAiToolCall): string {
  expect(call.isError, `${call.name} unexpectedly succeeded`).toBe(true);
  const result = call.result as { error?: unknown };
  return typeof result.error === "string" ? result.error : "";
}

/** What the Studio's own source store holds for a module, after an AI write. */
export function peek(page: Page, sourcePath: string): Promise<unknown> {
  return page.evaluate((path) => {
    const bag = window as unknown as {
      __VAL_STORES__: {
        system: {
          sourceStore: { peek(p: string): { status: string; data?: unknown } };
        };
      };
    };
    const peeked = bag.__VAL_STORES__.system.sourceStore.peek(path);
    return peeked.status === "ready" ? (peeked.data ?? null) : peeked.status;
  }, sourcePath);
}
