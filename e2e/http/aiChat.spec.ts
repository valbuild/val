import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  mock,
  openHttpStudio,
  publishAll,
  sessionCookie,
  type MockAiToolCall,
} from "./httpMode";

/**
 * The assistant's tools, end to end.
 *
 * ## What is actually under test
 *
 * Every tool the assistant can call is implemented in the BROWSER
 * (`packages/ui/spa/hooks/useAI.ts`): the service sends `ai_tool_call`, the
 * Studio reads its own stores, writes a patch through `patchStore`, and answers
 * with `ai_tool_result`. So one tool call is a round trip through the store
 * system, the sync engine, the Studio's server and the content service — and the
 * unit tests see none of that. Four AI write paths once applied edits locally and
 * saved nothing, with the tool reporting success, and the whole unit suite passed
 * through it (see the note at the top of `playwright.config.ts`).
 *
 * The model is not under test and is not present. `e2e/mock-content-host` plays a
 * SCRIPTED turn instead: the test says "this turn calls create_patch with these
 * arguments", the mock sends exactly that and blocks until the Studio answers.
 * What the mock records — the arguments it sent and the result it got back — is
 * the assertion surface, and it is deterministic in a way a real model is not.
 *
 * ## Why `http` mode
 *
 * An image attached in the chat never touches the app's disk: the browser uploads
 * it straight to the content service (`POST /ai/images`, with the presigned
 * nonce), the model is told only an opaque key, and turning that key into patch
 * bytes is another call to the service
 * (`patches/{id}/files/from-session-file`). `fs` mode has a path through the same
 * service, but it needs a personal access token a checkout does not have — so
 * proxy mode is where this flow can be run at all.
 */

const MEDIA_FIELDS = "/content/mediaFields.val.ts";
const GALLERY = "/content/media.val.ts";
const TAGS = "/content/tags.val.ts";
const IMAGE = "e2e/fixtures/blue-8x8.png";

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
  // A desktop shell: the assistant is reached from the top bar, which the mobile
  // breakpoint replaces with its own chrome. Wide enough to be unambiguous.
  viewport: { width: 1600, height: 1000 },
});

/**
 * Open the Studio and the assistant panel.
 *
 * The assistant is a floating panel rather than a fixed column, so it is behind
 * the top bar's button and is not mounted until it is opened — which is also
 * when its socket is opened. Everything below therefore starts here rather than
 * with `openHttpStudio`.
 */
async function openChatStudio(page: Page): Promise<void> {
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
async function composer(page: Page): Promise<Locator> {
  const editor = page
    .locator("#val-shadow-root")
    .locator('.val-chat-editor-content .ProseMirror[contenteditable="true"]');
  await expect(editor, "the assistant never connected").toBeVisible({
    timeout: 60_000,
  });
  return editor;
}

/** Type a prompt and send it. */
async function send(page: Page, text: string): Promise<void> {
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
async function attachImage(page: Page, file = IMAGE): Promise<void> {
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
async function toolCalls(expected: number): Promise<MockAiToolCall[]> {
  await expect
    .poll(async () => (await mock.aiState()).toolCalls.length, {
      timeout: 60_000,
      message: "the assistant's tool calls never came back",
    })
    .toBe(expected);
  return (await mock.aiState()).toolCalls;
}

/** A successful tool result, narrowed so a test can read its patch id. */
function okResult(call: MockAiToolCall): {
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
function errorMessage(call: MockAiToolCall): string {
  expect(call.isError, `${call.name} unexpectedly succeeded`).toBe(true);
  const result = call.result as { error?: unknown };
  return typeof result.error === "string" ? result.error : "";
}

/** What the Studio's own source store holds for a module, after an AI write. */
function peek(page: Page, sourcePath: string): Promise<unknown> {
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

test.beforeEach(async () => {
  await mock.reset();
});

test.describe("ai chat tools", () => {
  /**
   * The plumbing, on the simplest tool there is.
   *
   * `get_all_schema` reads the schema store and answers — no writes, no server
   * round trip — so a failure here is the connection, the script player or the
   * tool dispatch, and every test below can then take those for granted.
   */
  test("answers a tool call from the Studio's own stores", async ({ page }) => {
    await openChatStudio(page);
    await mock.aiScript({
      steps: [{ type: "tool", name: "get_all_schema" }],
      response: "Here is what I found.",
    });

    await send(page, "What content is there?");

    const [call] = await toolCalls(1);
    expect(call.name).toBe("get_all_schema");
    expect(call.isError).toBe(false);
    expect(Object.keys(call.result as Record<string, unknown>)).toContain(
      MEDIA_FIELDS,
    );

    // And the turn reads as a turn: the tool's label, then the reply.
    //
    // The reply is matched WITHOUT `.first()` on purpose, and that is an
    // assertion: two matches is a strict-mode violation, which is how this
    // catches the reply being rendered twice. It was — `completeAssistantMessage`
    // appended from inside a state updater, and `StrictMode` runs those twice.
    // Do not add `.first()` here to quieten a failure; find the duplicate.
    // (The tool label needs it for an innocent reason: the icon and the text sit
    // in nested spans with the same text content.)
    const studio = page.locator("#val-shadow-root");
    await expect(studio.getByText("Reading schemas").first()).toBeVisible();
    await expect(studio.getByText("Here is what I found.")).toBeVisible();
  });

  /**
   * A write, with no image involved.
   *
   * The baseline for everything below: `create_patch` is the tool that goes all
   * the way through — speculative validation, `patchStore.createPatch`, the sync
   * to the content service — and this is the shape of it without the media flow
   * on top. If this passes and an image test fails, the failure is in the image
   * flow rather than in writing at all.
   */
  test("create_patch writes through the store and reaches the content service", async ({
    page,
  }) => {
    await openChatStudio(page);
    await mock.aiScript({
      steps: [
        {
          type: "tool",
          name: "create_patch",
          arguments: {
            module_file_path: TAGS,
            patch: [
              { op: "replace", path: ["guides", "label"], value: "Guidebooks" },
            ],
          },
        },
      ],
      response: "Renamed it.",
    });

    await send(page, "Rename the guides tag");

    const [call] = await toolCalls(1);
    okResult(call);

    // The Studio shows it...
    expect(JSON.stringify(await peek(page, TAGS))).toContain("Guidebooks");
    // ...and the content service was told about it, which is the half that once
    // silently did not happen.
    await expect
      .poll(
        async () =>
          (await mock.state()).patches.filter((patch) => patch.path === TAGS)
            .length,
        {
          timeout: 30_000,
          message: "the AI's patch never reached the content service",
        },
      )
      .toBe(1);
  });

  /**
   * The flow this suite exists for: an image the editor attached becomes a patch.
   *
   * Three hand-offs, none of which any other test covers: the browser uploads the
   * bytes to the content service and gets a key; the key travels to the model in
   * an `image_key` block beside the prompt; and `create_patch` carries that key
   * back as a session-key sentinel, which the Studio turns into real patch bytes
   * before the patch is written. The model never sees or moves the bytes — it
   * only ever names the key.
   */
  test("an attached image becomes an image field through create_patch", async ({
    page,
  }) => {
    await openChatStudio(page);
    await attachImage(page);
    await mock.aiScript({
      steps: [
        {
          type: "tool",
          name: "create_patch",
          arguments: {
            module_file_path: MEDIA_FIELDS,
            patch: [
              {
                op: "replace",
                path: ["image"],
                value: {
                  // Resolved by the mock to the key the content service handed
                  // out for the first attachment — the test cannot know it, and
                  // neither could a model before reading the prompt.
                  key: "{{imageKey:0}}",
                  filePath: "/public/val/ai-hero.png",
                  _type: "ai_session_file",
                  _tag: "image",
                  alt: "A blue square",
                },
              },
            ],
          },
        },
      ],
      response: "Added your image.",
    });

    await send(page, "Use this image as the hero");

    // The prompt carried the key as a content block, not merely as prose.
    // Polled, not read straight after `send`: the prompt travels over the socket,
    // so a bare read here races the send and would pass or fail on timing.
    await expect
      .poll(async () => (await mock.aiState()).prompts.length, {
        timeout: 30_000,
        message: "the prompt never reached the assistant",
      })
      .toBe(1);
    const { prompts, images } = await mock.aiState();
    expect(prompts[0].imageKeys).toEqual([images[0].key]);
    expect(
      prompts[0].text,
      "the model was not told which key to use",
    ).toContain(images[0].key);

    const [call] = await toolCalls(1);
    const result = okResult(call);

    // The field now holds a real image source: the path the tool named, plus the
    // dimensions the content service read — which the model never supplied.
    const written = (await peek(page, MEDIA_FIELDS)) as {
      image: Record<string, unknown>;
    };
    expect(written.image).toMatchObject({
      path: "/public/val/ai-hero.png",
      width: 8,
      height: 8,
      mimeType: "image/png",
      alt: "A blue square",
    });

    // And the bytes are attached to the patch that references them, on the
    // content service — the mismatch that used to make the image resolve to
    // nothing was exactly a patch id that did not line up here.
    await expect
      .poll(async () => (await mock.state()).patchFiles, { timeout: 30_000 })
      .toHaveLength(1);
    const [uploaded] = (await mock.state()).patchFiles;
    expect(uploaded.patchId).toBe(result.patchId);
    expect(uploaded.filePath).toBe("/public/val/ai-hero.png");
    expect(uploaded.type).toBe("image");
    expect(uploaded.bytes).toBeGreaterThan(0);

    // The editor can actually see it: unpublished, so the only way to serve
    // these bytes is out of the patch.
    const served = await page.request.get(
      `/api/val/files/public/val/ai-hero.png?patch_id=${result.patchId}`,
    );
    expect(served.status()).toBe(200);
    // Byte for byte, against the file that was attached. A length check would
    // not do: the bug this asserts against replaced the PNG with a UUID, and
    // "some bytes came back" is exactly what it looked like.
    expect(await served.body()).toEqual(await readFile(IMAGE));
  });

  /**
   * And publishing carries those bytes into the commit.
   *
   * Separate from the write above because it is a separate failure: a patch file
   * the commit cannot find is a 400 from the content service, and the shape of
   * an AI-written file op (its `value` is a session key, not a hash) is the
   * reason that is worth checking rather than assuming.
   */
  test("an AI-written image survives publish", async ({ page }) => {
    await openChatStudio(page);
    await attachImage(page);
    await mock.aiScript({
      steps: [
        {
          type: "tool",
          name: "create_patch",
          arguments: {
            module_file_path: MEDIA_FIELDS,
            patch: [
              {
                op: "replace",
                path: ["image"],
                value: {
                  key: "{{imageKey:0}}",
                  filePath: "/public/val/ai-published.png",
                  _type: "ai_session_file",
                  _tag: "image",
                  alt: "A blue square",
                },
              },
            ],
          },
        },
      ],
    });

    await send(page, "Use this image as the hero");
    okResult((await toolCalls(1))[0]);
    await expect
      .poll(async () => (await mock.state()).patches.length, {
        timeout: 30_000,
      })
      .toBe(1);

    const published = await publishAll(page, "The assistant added an image");
    expect(published.status, published.message ?? "").toBe("published");

    const state = await mock.state();
    expect(state.commits).toHaveLength(1);
    expect(state.repoOverlay, "the image did not land in the commit").toContain(
      "/examples/next/public/val/ai-published.png",
    );
    expect(await mock.committedSource(MEDIA_FIELDS)).toContain(
      "/public/val/ai-published.png",
    );
    // And it is the image, not something the size of a session key. The path
    // lands in the commit either way, so this is the assertion that can tell.
    expect(await mock.committedBytes("/public/val/ai-published.png")).toBe(
      (await readFile(IMAGE)).byteLength,
    );
  });

  /**
   * Galleries take a different tool, and the model is told so.
   *
   * `s.images()` keys its entries BY file path and stores the metadata as the
   * value, so the session-key sentinel has nowhere to go — `create_patch` refuses
   * rather than writing something malformed, and the refusal names the tool to
   * retry with. That name is what the model acts on, so it is worth asserting on
   * rather than just "it failed".
   */
  test("create_patch refuses a gallery and points at the gallery tool", async ({
    page,
  }) => {
    await openChatStudio(page);
    await attachImage(page);
    await mock.aiScript({
      steps: [
        {
          type: "tool",
          name: "create_patch",
          arguments: {
            module_file_path: GALLERY,
            patch: [
              {
                op: "add",
                path: ["/public/val/images/wrong.png"],
                value: {
                  key: "{{imageKey:0}}",
                  filePath: "/public/val/images/wrong.png",
                  _type: "ai_session_file",
                  _tag: "image",
                },
              },
            ],
          },
        },
      ],
    });

    await send(page, "Put this in the media gallery");

    const [call] = await toolCalls(1);
    expect(errorMessage(call)).toContain("add_session_image_to_gallery");
    expect(
      (call.result as { suggestedTool?: string }).suggestedTool,
      "the retry hint is a field of its own, which is what the model reads",
    ).toBe("add_session_image_to_gallery");
    // Nothing was written, and no bytes were moved.
    expect((await mock.state()).patchFiles).toHaveLength(0);
    expect(JSON.stringify(await peek(page, GALLERY))).not.toContain(
      "wrong.png",
    );
  });

  /**
   * The gallery tool itself: an attached image becomes a gallery entry.
   *
   * A different patch shape from the field above — an `add` whose KEY is the file
   * path and whose value is the metadata alone — built by the Studio from the
   * schema rather than by the model, which is why the model is only asked for the
   * key, the path and the alt text.
   */
  test("add_session_image_to_gallery adds an entry with the service's metadata", async ({
    page,
  }) => {
    await openChatStudio(page);
    await attachImage(page);
    await mock.aiScript({
      steps: [
        {
          type: "tool",
          name: "add_session_image_to_gallery",
          arguments: {
            image_key: "{{imageKey:0}}",
            module_file_path: GALLERY,
            file_path: "/public/val/images/ai-added.png",
            alt: "A blue square",
          },
        },
      ],
      response: "It is in the gallery now.",
    });

    await send(page, "Add this to the media gallery");

    const [call] = await toolCalls(1);
    const result = okResult(call);
    expect(result.filePath).toBe("/public/val/images/ai-added.png");

    const gallery = (await peek(page, GALLERY)) as Record<
      string,
      Record<string, unknown>
    >;
    expect(gallery["/public/val/images/ai-added.png"]).toMatchObject({
      width: 8,
      height: 8,
      mimeType: "image/png",
      alt: "A blue square",
    });

    await expect
      .poll(async () => (await mock.state()).patchFiles, { timeout: 30_000 })
      .toHaveLength(1);
    const [uploaded] = (await mock.state()).patchFiles;
    expect(uploaded.patchId).toBe(result.patchId);
    expect(uploaded.filePath).toBe("/public/val/images/ai-added.png");

    // The existing entry is untouched: a gallery add is an add, not a replace.
    expect(gallery["/public/val/images/logo.png"]).toBeTruthy();
  });

  /**
   * Removing a gallery entry: the one AI write whose patch carries a `file` op
   * with no data.
   *
   * Worth its own test because the fix for the image-clobbering bug had to leave
   * this path alone — "the bytes are already uploaded" says nothing about
   * removing them, and a flag that skipped every file op would have made this
   * tool silently stop deleting. Two turns rather than removing a fixture entry,
   * so the test owns both ends of the entry's life.
   */
  test("remove_image_gallery_entry takes the entry back out", async ({
    page,
  }) => {
    await openChatStudio(page);
    await attachImage(page);
    await mock.aiScript({
      steps: [
        {
          type: "tool",
          name: "add_session_image_to_gallery",
          arguments: {
            image_key: "{{imageKey:0}}",
            module_file_path: GALLERY,
            file_path: "/public/val/images/ai-temporary.png",
            alt: "A blue square",
          },
        },
      ],
    });
    await send(page, "Add this to the media gallery");
    okResult((await toolCalls(1))[0]);
    await expect
      .poll(async () => (await mock.state()).patchFiles, { timeout: 30_000 })
      .toHaveLength(1);

    await mock.aiScript({
      steps: [
        {
          type: "tool",
          name: "remove_image_gallery_entry",
          arguments: {
            module_file_path: GALLERY,
            file_path: "/public/val/images/ai-temporary.png",
          },
        },
      ],
      response: "Removed it.",
    });
    await send(page, "Actually, remove it again");

    const calls = await toolCalls(2);
    okResult(calls[1]);
    const gallery = (await peek(page, GALLERY)) as Record<string, unknown>;
    expect(gallery["/public/val/images/ai-temporary.png"]).toBeUndefined();
    expect(
      gallery["/public/val/images/logo.png"],
      "the removal took a neighbour with it",
    ).toBeTruthy();

    // Both turns are in the chain, and what gets published is a gallery without
    // the entry.
    //
    // Only the module's source is asserted on. The bytes still reach the commit:
    // `prepare` collects every `file` op in the chain, and an add followed by a
    // remove leaves a file the committed source no longer names. That is not
    // specific to the assistant — a manual gallery add-then-publish-then-delete
    // does the same — so it is recorded here rather than asserted, which would
    // make this test fail the day someone fixes it.
    await expect
      .poll(async () => (await mock.state()).patches.length, {
        timeout: 30_000,
      })
      .toBe(2);
    const published = await publishAll(page, "Never mind that image");
    expect(published.status, published.message ?? "").toBe("published");
    const committed = await mock.committedSource(GALLERY);
    expect(committed).toBeTruthy();
    expect(
      committed,
      "the removed entry is still in the committed gallery",
    ).not.toContain("ai-temporary.png");
    expect(committed).toContain("logo.png");
  });

  /**
   * `set_session_name` is the one tool that answers over HTTP rather than from a
   * store.
   *
   * It goes out through the Studio's server (`PATCH /ai/sessions/{id}`) to the
   * content service, so it covers a proxy route none of the others touch — and
   * the name it sets is what the session picker shows for this conversation
   * afterwards.
   */
  test("set_session_name names the conversation on the service", async ({
    page,
  }) => {
    await openChatStudio(page);
    await mock.aiScript({
      steps: [
        {
          type: "tool",
          name: "set_session_name",
          arguments: { name: "Rename the guides tag" },
        },
      ],
      response: "Named it.",
    });

    await send(page, "Rename the guides tag");

    const [call] = await toolCalls(1);
    expect(call.isError).toBe(false);
    await expect
      .poll(
        async () =>
          (await mock.aiState()).sessions.map((session) => session.name),
        {
          timeout: 30_000,
          message: "the session name never reached the content service",
        },
      )
      .toContain("Rename the guides tag");
  });

  /**
   * A key the model made up, and the recovery the Studio offers for it.
   *
   * This is a real failure mode rather than a hypothetical: a vision model sees
   * the image as its own internal file id (`file-...`) and reaches for that
   * instead of the key in the prompt. The content service answers 400 with the
   * keys that DO exist, and the Studio has to pass those through — a bare "not
   * found" leaves the model with nothing to retry with.
   */
  test("an unknown image key comes back with the keys that exist", async ({
    page,
  }) => {
    await openChatStudio(page);
    await attachImage(page);
    const realKey = (await mock.aiState()).images[0].key;
    await mock.aiScript({
      steps: [
        {
          type: "tool",
          name: "add_session_image_to_gallery",
          arguments: {
            image_key: "file-something-the-model-invented",
            module_file_path: GALLERY,
            file_path: "/public/val/images/nope.png",
            alt: "A blue square",
          },
        },
      ],
    });

    await send(page, "Add this to the media gallery");

    const [call] = await toolCalls(1);
    const message = errorMessage(call);
    expect(message).toContain("file-something-the-model-invented");
    expect(
      message,
      "the model was not told which keys it could have used",
    ).toContain(realKey);
    expect((await mock.state()).patchFiles).toHaveLength(0);
  });

  /**
   * The one tool that waits for the human.
   *
   * `ask_user_question` sends no result of its own — the card does, when the
   * editor submits it — so the turn stays open until they answer, and the
   * server-side timeout is disabled for it. Both halves are covered here: the
   * card renders from the tool's arguments, and the answer travels back as the
   * result of that same call.
   */
  test("ask_user_question waits for the editor and returns their answer", async ({
    page,
  }) => {
    await openChatStudio(page);
    await mock.aiScript({
      steps: [
        {
          type: "tool",
          name: "ask_user_question",
          // Same as the tool declares: the card blocks on a human, so no timeout.
          timeoutMs: null,
          arguments: {
            questions: [
              {
                question: "Which page should I update?",
                header: "Page",
                options: [{ label: "Home" }, { label: "About" }],
              },
            ],
          },
        },
      ],
      response: "Updating the About page.",
    });

    await send(page, "Fix the typo");

    const studio = page.locator("#val-shadow-root");
    await expect(studio.getByText("Which page should I update?")).toBeVisible();
    await studio.getByRole("radio", { name: "About" }).click();
    await studio.getByRole("button", { name: "Submit" }).click();

    const [call] = await toolCalls(1);
    expect(call.isError).toBe(false);
    expect(call.result).toEqual({
      answers: [
        {
          question: "Which page should I update?",
          selectedOptions: [1],
          customAnswer: null,
        },
      ],
    });
    await expect(studio.getByText("Updating the About page.")).toBeVisible();
  });

  /**
   * The panel is a panel: it closes, and the conversation is still there.
   *
   * The shell renders the assistant on demand, so closing it UNMOUNTS the chat —
   * the transcript on screen after reopening cannot be something the browser was
   * still holding. It is read back from the service by the session id in the URL,
   * which is the whole reason `AIChatSurface` seeds itself from there.
   */
  test("keeps the conversation when the panel is closed and reopened", async ({
    page,
  }) => {
    await openChatStudio(page);
    await mock.aiScript({
      steps: [{ type: "tool", name: "get_all_schema" }],
      response: "There are a few content files.",
    });

    await send(page, "What content is there?");
    await toolCalls(1);
    const studio = page.locator("#val-shadow-root");
    await expect(
      studio.getByText("There are a few content files."),
    ).toBeVisible();

    await studio.getByRole("button", { name: "Close AI assistant" }).click();
    await expect(
      studio.getByText("There are a few content files."),
      "the panel did not actually close",
    ).toBeHidden();

    await studio.getByRole("button", { name: "AI assistant" }).click();
    await expect(
      studio.getByText("There are a few content files."),
      "the conversation was not restored",
    ).toBeVisible();
    await expect(studio.getByText("What content is there?")).toBeVisible();
  });

  /**
   * Mentioning a field opens the assistant and puts the field in the composer.
   *
   * Both halves matter and the second is the one that broke: the mention OPENS
   * the panel, and opening the panel is what mounts the editor the reference has
   * to go into — so the insert happens against a ref that is still null. The
   * reference is queued in `AIChatActionsProvider` and delivered when the editor
   * arrives, and what proves it is the path reaching the assistant.
   */
  test("mentioning a field opens the assistant with the field in it", async ({
    page,
  }) => {
    await openHttpStudio(page, `/val/~${TAGS}`);
    const studio = page.locator("#val-shadow-root");
    await mock.aiScript({ steps: [], response: "Looking at that field." });

    // A record opens on its list of entries, and the mention button is on a
    // field — so one has to be open before there is anything to mention.
    await studio.getByText("guides", { exact: true }).click();
    await expect(
      studio.getByRole("button", { name: "Mention this field in AI chat" }),
    ).not.toHaveCount(0);

    // The assistant is dismissed: this click has to reveal it AND land the
    // reference. Hidden rather than absent — the panel stays mounted so a turn
    // in flight survives being dismissed — so this asks about visibility.
    await expect(
      studio.locator(".val-chat-editor-content"),
      "the assistant was already open, so this proves nothing",
    ).toBeHidden();
    await studio
      .getByRole("button", { name: "Mention this field in AI chat" })
      .first()
      .click();

    const editor = await composer(page);
    await editor.click();
    await page.keyboard.type("what is this?");
    await studio.getByRole("button", { name: "Send message" }).click();

    await expect
      .poll(async () => (await mock.aiState()).prompts.length, {
        timeout: 30_000,
        message: "the prompt never reached the assistant",
      })
      .toBe(1);
    const [prompt] = (await mock.aiState()).prompts;
    expect(
      prompt.text,
      "the mentioned field did not reach the assistant",
    ).toContain(TAGS);
    expect(prompt.text).toContain("what is this?");
  });

  /**
   * A turn survives a click in the editor.
   *
   * The panel's scrim covers the whole viewport and closes on any click outside
   * it, so "dismissing" the assistant is one stray click away — and the obvious
   * thing to do while the model is working is to carry on editing. Unmounting
   * the chat on close meant the `ai_tool_call` reached no handler, no result was
   * ever sent, the edit never landed, and nothing anywhere said so.
   *
   * Driven with a tool the turn BLOCKS on, so the click lands mid-turn: the mock
   * will not move on until the Studio answers.
   */
  test("finishes a turn started before the panel was dismissed", async ({
    page,
  }) => {
    await openChatStudio(page);
    await mock.aiScript({
      steps: [
        {
          type: "tool",
          name: "create_patch",
          // Long enough that the click below is comfortably inside the turn.
          timeoutMs: 60_000,
          arguments: {
            module_file_path: TAGS,
            patch: [
              { op: "replace", path: ["guides", "label"], value: "Dismissed" },
            ],
          },
        },
      ],
      response: "Done anyway.",
    });

    await send(page, "Rename the guides tag");
    // A click in the editor column, by coordinate: the panel's scrim covers the
    // whole viewport, so whatever is underneath, the scrim is what receives this
    // and closes the panel. Well left of the 420px panel on the right.
    await page.mouse.click(200, 500);
    await expect(
      page.locator("#val-shadow-root").locator(".val-chat-editor-content"),
      "the click did not dismiss the assistant, so this proves nothing",
    ).toBeHidden();

    const [call] = await toolCalls(1);
    okResult(call);
    expect(JSON.stringify(await peek(page, TAGS))).toContain("Dismissed");
    await expect
      .poll(
        async () =>
          (await mock.state()).patches.filter((patch) => patch.path === TAGS)
            .length,
        {
          timeout: 30_000,
          message: "the AI's patch never reached the content service",
        },
      )
      .toBe(1);
  });

  /**
   * When the assistant cannot be started, the composer says so and offers a way
   * back.
   *
   * The studio retries `/ai/initialize` five times and then stops. What it shows
   * for that is the one thing a person can act on, so it is worth pinning: a
   * composer with nothing behind it invites a question that goes nowhere, and
   * silence is the only feedback.
   */
  test("says so when it cannot reach the assistant, and can be retried", async ({
    page,
  }) => {
    await mock.aiOffline(true);
    await openHttpStudio(page);
    const studio = page.locator("#val-shadow-root");
    await studio.getByRole("button", { name: "AI assistant" }).click();

    // Five attempts, three seconds apart, before the studio gives up.
    await expect(
      studio.getByText("The assistant is unavailable"),
      "the studio never reported giving up",
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      studio.locator(
        '.val-chat-editor-content .ProseMirror[contenteditable="true"]',
      ),
      "a composer with nothing listening",
    ).toHaveCount(0);

    // And the way back works: the service returns, the button reconnects.
    await mock.aiOffline(false);
    await studio.getByRole("button", { name: "Try again" }).click();
    await expect(
      studio.locator(
        '.val-chat-editor-content .ProseMirror[contenteditable="true"]',
      ),
    ).toBeVisible({ timeout: 30_000 });
    await expect(studio.getByText("The assistant is unavailable")).toHaveCount(
      0,
    );
  });

  /**
   * Several tools in one turn, in order, each waiting for the last.
   *
   * A turn is a loop, not a single call, and the ordering is load-bearing: a
   * `create_patch` that answered before its write landed would let the next tool
   * read stale content. Reading back the value this same turn just wrote is the
   * cheapest way to assert that the loop is actually sequential.
   */
  test("runs a multi-tool turn in order", async ({ page }) => {
    await openChatStudio(page);
    await mock.aiScript({
      steps: [
        { type: "tool", name: "get_all_schema" },
        {
          type: "tool",
          name: "create_patch",
          arguments: {
            module_file_path: TAGS,
            patch: [
              { op: "replace", path: ["guides", "label"], value: "Handbooks" },
            ],
          },
        },
        {
          type: "tool",
          name: "get_source",
          arguments: { module_file_path: TAGS },
        },
        { type: "tool", name: "validate_content" },
      ],
      response: "All done.",
    });

    await send(page, "Rename the guides tag and check it");

    const calls = await toolCalls(4);
    expect(calls.map((call) => call.name)).toEqual([
      "get_all_schema",
      "create_patch",
      "get_source",
      "validate_content",
    ]);
    okResult(calls[1]);
    // The read that followed the write sees the write.
    expect(JSON.stringify(calls[2].result)).toContain("Handbooks");
    // And nothing the assistant did broke the module.
    expect(JSON.stringify(calls[3].result)).not.toContain(TAGS);
  });
});
