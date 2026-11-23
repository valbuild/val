import { expect, test, type Page } from "@playwright/test";
import { MOCK_PROPOSAL } from "../http/config";
import { httpTarget, PROPOSAL_APP } from "../http/httpMode";
import { send, toolCalls } from "../http/assistant";

/**
 * Code mode's preview while the assistant changes code.
 *
 * What a person reported as "code mode flashes after writes": a second after
 * EVERY `write_files` the Studio asked Val Build for a quick preview, and
 * showed it by replacing the canvas's `<iframe>` -- so the page went blank
 * (white, for the best part of a second) once per write, each time for a
 * state half way through the change. A three-edit change was three blank
 * pages, and six quick previews asked for: each one was asked for again when
 * the page it was shown in came up.
 *
 * Now a change is ONE quick preview, started when the turn ends from what the
 * last staging answered, and the page it replaces stays on screen until the
 * new one has rendered.
 *
 * At a proposal's address, which only this project's app is
 * (`playwright.config.ts`), against the mock content host, whose Val Build
 * answers a quick preview with no files: WHEN one is made and how the canvas
 * takes it is the subject, not what is in it. The model is the mock's
 * scripted turn; the tool calls, the staging, the rule and the swap are the
 * product's.
 */
const { sessionCookie, openHttpStudio, mock } = httpTarget(PROPOSAL_APP);

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

/** The Studio at the proposal, in code mode, with the page in the canvas live. */
async function openCodeMode(page: Page): Promise<void> {
  const on = await page.request.post(
    `/api/val/proposals-api/${MOCK_PROPOSAL}/code-mode`,
    { data: { on: true } },
  );
  expect(on.ok(), await on.text()).toBe(true);
  await openHttpStudio(page);
  const studio = page.locator("#val-shadow-root");
  await studio.getByRole("button", { name: "AI assistant" }).first().click();
  /*
   * Live: the page answered, in preview mode, so it can take a quick
   * preview. A browser that has never opened this site starts with preview
   * mode off, and the Studio turns it on by sending the frame through
   * `/api/val/enable` -- a page load of its own, seconds in. The
   * assistant's Select is enabled exactly while the canvas is live, in
   * code mode: wait for it, or that load is counted as the change's.
   */
  await expect(
    studio.getByRole("button", {
      name: "Point the assistant at something on the page",
    }),
  ).toBeEnabled({ timeout: 120_000 });
  await expect(studio.locator('[data-val-tour="canvas"] iframe')).toHaveCount(
    1,
  );
}

/**
 * Watch the canvas, every frame the browser draws: how many of them show a
 * page with nothing on it. The frame on top is the one a person sees -- the
 * last in the canvas, which is the one being replaced while there are two.
 */
async function watchCanvas(page: Page): Promise<void> {
  await page.evaluate(() => {
    const bag = window as unknown as {
      __canvas: {
        samples: number;
        blank: number;
        mostFrames: number;
        blankWas: string[];
      };
    };
    bag.__canvas = { samples: 0, blank: 0, mostFrames: 0, blankWas: [] };
    const root = document.querySelector("#val-shadow-root")?.shadowRoot;
    const tick = () => {
      const frames = Array.from(
        root?.querySelectorAll<HTMLIFrameElement>(
          '[data-val-tour="canvas"] iframe',
        ) ?? [],
      );
      const top = frames[frames.length - 1];
      if (top !== undefined) {
        bag.__canvas.samples += 1;
        bag.__canvas.mostFrames = Math.max(
          bag.__canvas.mostFrames,
          frames.length,
        );
        // Same origin: the canvas frames the site the Studio is on.
        const text = top.contentDocument?.body?.innerText ?? "";
        if (text.trim() === "") {
          bag.__canvas.blank += 1;
          // What was on top, for whoever reads the failure.
          bag.__canvas.blankWas.push(
            `${frames.length} frame(s), on top ${top.getAttribute("src")}: ` +
              `${top.contentDocument?.readyState} <body>${Array.from(
                top.contentDocument?.body?.children ?? [],
              )
                .map((element) => element.tagName.toLowerCase())
                .join(" ")}</body>`,
          );
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function canvasWatch(page: Page): Promise<{
  samples: number;
  blank: number;
  mostFrames: number;
  blankWas: string[];
}> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __canvas: {
            samples: number;
            blank: number;
            mostFrames: number;
            blankWas: string[];
          };
        }
      ).__canvas,
  );
}

test("a change of three edits is one quick preview, shown without the page going blank", async ({
  page,
}) => {
  await openCodeMode(page);

  /** Documents the canvas loaded as a quick preview. */
  const quickDocuments: string[] = [];
  page.on("request", (request) => {
    if (
      request.isNavigationRequest() &&
      request.frame() !== page.mainFrame() &&
      request.url().includes("val_quick=")
    ) {
      quickDocuments.push(request.url());
    }
  });
  await watchCanvas(page);

  const write = (n: number) => ({
    type: "tool" as const,
    name: "write_files",
    arguments: {
      files: {
        [`src/components/Flash${n}.tsx`]: `export const Flash${n} = () => <p>${n}</p>;\n`,
      },
      message: `Edit ${n}`,
    },
  });
  await mock.aiScript({
    steps: [
      write(0),
      // The model, between two edits of one change.
      { type: "pause", ms: 1_500 },
      write(1),
      { type: "pause", ms: 1_500 },
      write(2),
    ],
    response: "Done.",
  });
  await send(page, "Change the code");
  const calls = await toolCalls(3);
  for (const call of calls) {
    expect(call.isError, JSON.stringify(call.result)).toBe(false);
  }

  // One quick preview, of what the LAST edit staged...
  await expect
    .poll(async () => (await mock.quickPreviewsMade()).length, {
      timeout: 30_000,
      message: "no quick preview was made once the turn ended",
    })
    .toBe(1);
  const staged = await page.evaluate(async (name) => {
    const res = await fetch(`/api/val/proposals-api/${name}`);
    const body = (await res.json()) as {
      proposal: { staged: { inputs: string | null } };
    };
    return body.proposal.staged.inputs;
  }, MOCK_PROPOSAL);
  expect((await mock.quickPreviewsMade())[0].inputs).toBe(staged);

  // ...in front: the canvas holds that document and no other.
  const frames = page
    .locator("#val-shadow-root")
    .locator('[data-val-tour="canvas"] iframe');
  await expect
    .poll(
      async () =>
        (await frames.count()) === 1 &&
        ((await frames.first().getAttribute("src")) ?? "").includes(
          "val_quick=",
        ),
      { timeout: 30_000, message: "the quick preview never came to the front" },
    )
    .toBe(true);

  // Nothing more follows it: the page coming up is not a reason for another.
  await page.waitForTimeout(3_000);
  expect(await mock.quickPreviewsMade()).toHaveLength(1);
  expect(quickDocuments).toHaveLength(1);

  // And at no frame the browser drew was the page on top an empty one.
  const watched = await canvasWatch(page);
  expect(watched.samples).toBeGreaterThan(100);
  // The swap happened as a swap: both documents were there at once.
  expect(watched.mostFrames).toBe(2);
  expect(watched.blankWas).toEqual([]);
  expect(watched.blank).toBe(0);
});
