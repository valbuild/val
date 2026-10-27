import { expect, type Frame, type Locator, type Page } from "@playwright/test";
import { openStudio, test } from "../studio";

/**
 * The canvas on a site that has a login of its own.
 *
 * A dashboard, an intranet, a members' area: a page the site only renders for
 * someone it has signed in, by a cookie Val knows nothing about. Editing that
 * page in the Studio means the canvas has to be signed in too, and the reason
 * it can be is that the canvas is not a separate browser — it is a frame on
 * the SAME origin as the Studio, so the browser sends it the site's own
 * cookies like it sends them to any other tab. These tests pin that, both ways
 * an editor arrives:
 *
 *   - already signed in to the site, which is the everyday case: the canvas
 *     shows the page behind the login, live, and follows an edit;
 *   - not signed in, where the site redirects the canvas to its login page,
 *     and the editor signs in THERE, inside the canvas.
 *
 * The second is the one that was broken. The Studio marks the document it
 * loads with `?val_canvas=1`, and the site's redirect to `/login` is a new
 * document without it — so the page decided it was an ordinary tab, mounted
 * Val's whole overlay inside the canvas (a Studio in the Studio), and never
 * told the canvas it was there. The canvas sat on "Preview is not ready yet"
 * through the sign-in and after it, until someone pressed Reload.
 *
 * "Live" is asked of the Studio, not inferred from an edit arriving: the
 * overlay that should not be there relays edits too, by its own route, so
 * an edit showing up on the page passed while the canvas was dead.
 *
 * The fixture is `/dashboard` in `examples/tanstack`, gated in
 * `src/routes/_site.dashboard.tsx` by the `HttpOnly`, `SameSite=Lax` cookie
 * `src/auth/session.ts` sets.
 */

const STUDIO_ON_DASHBOARD =
  "/val/~/src/routes/_site.dashboard.val.ts?p=%22%2Fdashboard%22&canvas=1";
const TITLE = "Your dashboard";

/**
 * Fill in and submit the site's sign-in form, in the page or in the canvas.
 *
 * The button is disabled until the form has hydrated, so waiting for it to be
 * enabled is waiting for the handler that signs in.
 */
async function submitSignIn(form: Page | Frame, name: string): Promise<void> {
  const button = form.getByRole("button", { name: "Sign in" });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await form.getByLabel("Name").fill(name);
  await button.click();
}

/** Sign in to the site itself, the way a visitor does. */
async function signInToSite(page: Page, name: string): Promise<void> {
  await page.goto("/login?redirect=%2Fdashboard");
  await submitSignIn(page, name);
  await expect(page.getByText(`Signed in as ${name}`)).toBeVisible();
}

/** The canvas's frame, once it is on a page whose path starts `pathname`. */
async function canvasFrame(page: Page, pathname: string): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(
      () => {
        found = page.frames().find((frame) => {
          if (frame === page.mainFrame()) return false;
          try {
            return new URL(frame.url()).pathname === pathname;
          } catch {
            return false;
          }
        });
        return found?.url() ?? page.frames().map((frame) => frame.url());
      },
      { message: `the canvas never got to ${pathname}`, timeout: 30_000 },
    )
    .toEqual(expect.stringContaining(pathname));
  return found!;
}

/** The Studio's own input holding the page's title. */
function titleField(page: Page): Locator {
  return page.locator("#val-shadow-root input").first();
}

/**
 * The canvas is live on the page `frame` holds, and that page is the canvas.
 *
 * Two boundaries: the Studio's notice above the canvas, which only goes away
 * once the page has told the Studio it is there and in preview; and the page
 * itself, which must not be running a Val overlay of its own.
 */
async function expectCanvasLive(page: Page, frame: Frame): Promise<void> {
  await expect(
    page
      .locator("#val-shadow-root")
      .getByRole("status")
      .filter({ hasText: /preview|no answer/i }),
    "the canvas never went live: the page did not report back to the Studio",
  ).toHaveCount(0, { timeout: 30_000 });
  await expect(
    frame.locator("#val-overlay"),
    "the page in the canvas mounted Val's own overlay: a Studio in the Studio",
  ).toHaveCount(0);
}

/** An edit in the Studio reaches the page behind the login, tagged. */
async function expectCanvasFollowsEdits(page: Page): Promise<void> {
  const edited = `Dashboard, edited ${Date.now()}`;
  const title = titleField(page);
  await expect(title).toHaveValue(TITLE, { timeout: 30_000 });
  await title.fill(edited);
  const frame = await canvasFrame(page, "/dashboard");
  await expect(
    frame.locator("[data-val-path]").filter({ hasText: edited }).first(),
    "the edit did not reach the page behind the login",
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("the canvas, on a page behind the site's own login", () => {
  test("signed in to the site, the canvas shows the page and follows edits", async ({
    page,
  }) => {
    await signInToSite(page, "Ada");
    // Preview on, as an editor would have it; the enable endpoint redirects
    // through the gated page, which is a sign-in check in itself.
    await page.goto("/api/val/enable?redirect_to=%2Fdashboard");
    await expect(page.getByText("Signed in as Ada")).toBeVisible();

    await openStudio(page, STUDIO_ON_DASHBOARD);
    const frame = await canvasFrame(page, "/dashboard");
    // The site's own render of the gated page, signed in by its own cookie:
    // not the login page it sends everyone else to.
    await expect(frame.getByText("Signed in as Ada")).toBeVisible({
      timeout: 60_000,
    });
    await expectCanvasLive(page, frame);
    await expectCanvasFollowsEdits(page);
  });

  test("signed out, the canvas shows the site's login, and signing in there brings the page back live", async ({
    page,
  }) => {
    // Preview on, but no session: the editor has never signed in to the site.
    await page.goto("/api/val/enable?redirect_to=%2F");

    await openStudio(page, STUDIO_ON_DASHBOARD);
    const login = await canvasFrame(page, "/login");
    await expect(
      login.getByRole("heading", { name: "Sign in" }),
      "the site did not send a signed-out canvas to its login",
    ).toBeVisible({ timeout: 60_000 });
    // The login page is a document the Studio did not load, and still the
    // canvas: the redirect that brought it here dropped `val_canvas`.
    expect(new URL(login.url()).searchParams.get("val_canvas")).toBeNull();
    await expectCanvasLive(page, login);

    await submitSignIn(login, "Grace");

    const frame = await canvasFrame(page, "/dashboard");
    await expect(frame.getByText("Signed in as Grace")).toBeVisible({
      timeout: 30_000,
    });
    await expectCanvasLive(page, frame);
    await expectCanvasFollowsEdits(page);
  });
});
