import type { ConsoleMessage, Page } from "@playwright/test";

/**
 * "Did anything blow up in the page", for the smoke tests.
 *
 * Shared by `smoke.spec.ts` (Next) and `tanstack/studio.spec.ts` because the
 * question is the same one and the allowlist below has to be: an error that is
 * environmental on one app is environmental on the other, and a second copy of
 * this list would drift the moment one of them was added to.
 *
 * Why an uncaught error is the assertion that earns its keep: the two worst
 * Studio regressions anyone found by hand were a render loop and a crash during
 * first render. Neither failed a request, neither broke the server, and
 * thousands of unit tests passed through both. From outside the only signal was
 * an exception in the page.
 */

/**
 * Errors this environment produces whatever the Studio does.
 *
 * Enumerated rather than filtered by severity, so a NEW error of any kind fails.
 * The AI ones need a personal access token that a local checkout has no reason
 * to have; the certificate one is the sandbox's proxy CA, hit by the Google
 * Fonts stylesheet the apps link.
 */
const ALLOWED_CONSOLE_ERRORS: { pattern: RegExp; why: string }[] = [
  {
    pattern: /ERR_CERT_AUTHORITY_INVALID/,
    why: "the sandbox proxy's CA, on the Google Fonts stylesheet",
  },
  {
    pattern: /\/api\/val\/ai\//,
    why: "AI endpoints need a personal access token; a local checkout has none",
  },
  {
    pattern: /Could not read personal access token file/,
    why: "same, as the message rather than the URL",
  },
  {
    pattern: /the server responded with a status of (401|500)/,
    why: "the AI endpoints above, reported without their URL",
  },
];

function unexplained(message: ConsoleMessage): boolean {
  const text = message.text();
  const url = message.location().url;
  return !ALLOWED_CONSOLE_ERRORS.some(
    ({ pattern }) => pattern.test(text) || pattern.test(url),
  );
}

export type PageProblems = {
  /** Uncaught errors — a render loop and a crash on mount both land here. */
  thrown: string[];
  /** Console errors that are not on the allowlist above. */
  logged: string[];
};

export function watchForProblems(page: Page): PageProblems {
  const problems: PageProblems = { thrown: [], logged: [] };
  page.on("pageerror", (error) => {
    problems.thrown.push(error.message.split("\n")[0]);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && unexplained(message)) {
      problems.logged.push(message.text().split("\n")[0]);
    }
  });
  return problems;
}

/** The Studio renders inside a shadow root, so `page.locator` cannot see in. */
export async function renderedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.getElementById("val-shadow-root");
    return host?.shadowRoot?.textContent ?? "";
  });
}
