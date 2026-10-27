import { test } from "@playwright/test";
import { openHttpStudio, sessionCookie } from "./httpMode";

/**
 * Load the proxy-mode Studio once before any `tanstack-http` test times
 * anything.
 *
 * The reason `../tanstack/warm.setup.ts` exists, for the other copy of the
 * app: Vite transforms the SPA's module graph on demand and re-optimizes when
 * the first `/val` load discovers a dependency it had not bundled, which 404s
 * what is in flight and reloads the page. A second server with its own cache
 * pays that again, and no test should be the one that does.
 *
 * Opened through `openHttpStudio`, so the warm-up also proves the app is in
 * proxy mode and talking to ITS mock -- a misconfigured server fails here,
 * with a message that names the socket, rather than in every test after.
 */
test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test("the Studio's bundle is built and the proxy-mode TanStack app has compiled", async ({
  page,
}) => {
  // Generous: this is the cold compile every other timeout in the suite is
  // trying not to be.
  test.setTimeout(180_000);
  await openHttpStudio(page);
});
