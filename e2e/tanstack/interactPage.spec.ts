import { expect, type Page } from "@playwright/test";
import { openStudio, test } from "../studio";
import { askThePage } from "./askThePage";

/**
 * The assistant using the page in the preview (`interact_page`,
 * `pageInteraction.ts`): typing into a real form, a click on its submit
 * held for the person, and then allowed -- each answered with the page AFTER
 * the action took effect.
 *
 * In a real browser because that is what the answer is about: a React form
 * that hydrates, a server function the submit calls, a client-side
 * navigation after it, and a settle that has to wait for all of it. The
 * Studio's half -- the tool, the approval card, asking only a bridge that
 * lists the action, opening a path and changing the width -- is unit tested
 * (`pageTools.test.ts`, `pageSubmitGate.test.ts`,
 * `canvasInteraction.test.tsx`); this is the page's half, asked the way the
 * Studio asks it.
 *
 * The page is the site's own sign-in form: the Studio opens `/dashboard`,
 * which sends a signed-out canvas to `/login` (see `signedInPreview.spec`).
 * Each test has a browser context of its own, so the sign-in here is
 * nobody else's.
 */
test.use({ viewport: { width: 1512, height: 900 } });

const STUDIO_ON_DASHBOARD =
  "/val/~/src/routes/_site.dashboard.val.ts?p=%22%2Fdashboard%22&canvas=1";

/** Generous: the first load of a route in `vite dev` compiles it. */
const INTERACT_ANSWER_MS = 25_000;

type Outcome = {
  status?: string;
  interaction?: {
    did: string;
    settled: boolean;
    before: { url: string };
    after: { url: string; title?: string };
    snapshot: {
      outline: Array<{ kind: string; text?: string; selector: string }>;
    };
    log: unknown[];
  };
  approval?: { via: string; label: string; page: string };
  error?: string;
};

/**
 * The Studio on the dashboard, signed out of the site: preview on, as an
 * editor has it, and the site sends the canvas to its sign-in page. Waits
 * until the page has told the Studio it is there.
 */
async function openOnLogin(page: Page): Promise<void> {
  await page.goto("/api/val/enable?redirect_to=%2F");
  await openStudio(page, STUDIO_ON_DASHBOARD);
  await expect(
    page.locator("#val-shadow-root").getByRole("tab", { name: /On this page/ }),
  ).toBeVisible({ timeout: 60_000 });
}

let requests = 0;
async function interact(
  page: Page,
  action: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<Outcome> {
  const answer = await askThePage(
    page,
    {
      type: "interact",
      requestId: `e2e-interact-${++requests}-${Math.random()}`,
      action,
      timeoutMs: 15_000,
      ...extra,
    },
    "interacted",
    INTERACT_ANSWER_MS,
  );
  return Object(answer["outcome"]);
}

test.describe("using the page in the preview", () => {
  test("types into a form, waits for the person to submit it, and answers with the page after", async ({
    page,
  }) => {
    await openOnLogin(page);
    // The site sent the signed-out canvas to its sign-in page, live.
    const preview = page.frameLocator('iframe[title^="Preview of"]');
    await expect(preview.getByRole("button", { name: "Sign in" })).toBeEnabled({
      timeout: 60_000,
    });

    // What the Studio asks of a page it opened: settle, and read it.
    const opened = await interact(
      page,
      { kind: "settle" },
      { logFrom: "document" },
    );
    expect(opened.status).toBe("done");
    expect(opened.interaction?.after.url).toMatch(/^\/login/);
    const outline = opened.interaction?.snapshot.outline ?? [];
    // Selectors as read_page writes them, used as the model would.
    const field = outline.find((item) => item.kind === "input");
    const button = outline.find(
      (item) => item.kind === "button" && item.text === "Sign in",
    );
    expect(field, JSON.stringify(outline)).toBeDefined();
    expect(button, JSON.stringify(outline)).toBeDefined();

    const typed = await interact(page, {
      kind: "type",
      selector: field?.selector,
      text: "Ada",
    });
    expect(typed).toMatchObject({
      status: "done",
      interaction: { did: 'typed 3 characters into <input name="name">' },
    });
    await expect(preview.getByLabel("Name")).toHaveValue("Ada");

    // A submit reaches the site's backend: held for the person, not done.
    const held = await interact(page, {
      kind: "click",
      selector: button?.selector,
    });
    expect(held).toMatchObject({
      status: "needs-approval",
      approval: { via: "click", label: "Sign in" },
    });
    await expect(preview.getByText("Signed in as Ada")).toHaveCount(0);

    // Allowed: signed in, and the answer is the dashboard it went to.
    const submitted = await interact(
      page,
      { kind: "click", selector: button?.selector },
      { allowSubmit: true },
    );
    expect(submitted.status, JSON.stringify(submitted)).toBe("done");
    expect(submitted.interaction).toMatchObject({
      settled: true,
      before: { url: expect.stringMatching(/^\/login/) },
      after: { url: "/dashboard" },
    });
    expect(
      submitted.interaction?.snapshot.outline.map((item) => item.text),
    ).toContain("Signed in as Ada");
  });

  test("never types into a password field, and never leaves the site", async ({
    page,
  }) => {
    await openOnLogin(page);
    const preview = page.frameLocator('iframe[title^="Preview of"]');
    await expect(preview.getByRole("button", { name: "Sign in" })).toBeEnabled({
      timeout: 60_000,
    });
    // The site's own page, given what the test needs to try.
    await preview.locator("body").evaluate((body) => {
      const password = document.createElement("input");
      password.type = "password";
      password.id = "e2e-password";
      const away = document.createElement("a");
      away.href = "https://example.com/";
      away.id = "e2e-away";
      away.textContent = "Elsewhere";
      body.append(password, away);
    });
    expect(
      await interact(page, {
        kind: "type",
        selector: "#e2e-password",
        text: "hunter2",
      }),
    ).toMatchObject({
      status: "refused",
      error: expect.stringContaining("password"),
    });
    expect(
      await interact(page, { kind: "click", selector: "#e2e-away" }),
    ).toMatchObject({
      status: "refused",
      error: expect.stringContaining("another site"),
    });
  });
});
