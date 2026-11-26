/**
 * @jest-environment jsdom
 */
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  installPageLog,
  pageLogOf,
  QUICK_PREVIEW_RENDER_SCRIPT,
  type PageLog,
} from "@valbuild/shared/internal";

/**
 * A quick preview's page, and what its log says went wrong on it.
 *
 * Reported from code mode: every page check of a change failed on "React
 * minified error #418 (hydration mismatch, HTML text differing between server
 * and client)", which the check could not place -- "I could not tell from the
 * preview whether the change caused it or it was already there" -- and handed
 * to the assistant as a finding to fix.
 *
 * It is not the change, and not the site. A quick preview takes the server's
 * markup out of `<body>` before the app's scripts run
 * (`QUICK_PREVIEW_RENDER_SCRIPT`), so that React RENDERS the page with the new
 * code instead of hydrating the old markup, which keeps the old classes. That
 * is by design -- and React 19 reports a body with nothing to hydrate as a
 * hydration failure, an uncaught error (`reportError`), on every quick
 * preview. `read_page_log`, and so the page check, reads it as the page's.
 *
 * Driven with the product's own pieces: the render script the quick preview's
 * worker adds to the document, the page log the canvas bridge installs before
 * React hydrates (`installPageLog`), and React hydrating the whole document as
 * TanStack Start does (`hydrateRoot(document, <StartClient />)`). React and
 * the DOM are the edge.
 */

/** A site's page: the hero the report was about. */
function Page({ heading, dark }: { heading: string; dark: boolean }) {
  return (
    <html lang="no">
      <head>
        <title>Forside</title>
      </head>
      <body>
        <main>
          <section className={dark ? "bg-black text-white" : "bg-white"}>
            <p>Eyebrow</p>
            <h1>{heading}</h1>
            <a href="/kontakt">Kontakt oss</a>
          </section>
        </main>
      </body>
    </html>
  );
}

/**
 * The document the server sent, as the browser has it before any script
 * runs: the server's markup, and the router's dehydrated state as a script
 * in `<body>` (which the render script leaves where it is).
 */
function serverDocument(html: string) {
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  document.head.innerHTML = "<title>Forside</title>";
  document.body.innerHTML = body + "<script>window.$_TSR = {}</script>";
}

/** What a quick preview's worker adds to the document, run as the browser runs it. */
function runQuickPreviewRenderScript() {
  new Function(
    QUICK_PREVIEW_RENDER_SCRIPT.replace(/^<script>|<\/script>$/g, ""),
  )();
}

/** The errors the page log holds: what `read_page_log` hands the page check. */
function loggedErrors(log: PageLog) {
  return log
    .read({ levels: ["error"] })
    .entries.map((entry) => `${entry.source}: ${entry.text.split("\n")[0]}`);
}

describe("a quick preview's page log", () => {
  let root: Root | null = null;

  beforeEach(() => {
    // React's own dev warnings go to the console; the log is what is asserted.
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    pageLogOf(window)?.uninstall();
    jest.restoreAllMocks();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  test("a quick preview logs no error the page did not make", async () => {
    // The last build's server rendered the page...
    serverDocument(
      renderToString(<Page heading="Dette er så gøy" dark={false} />),
    );
    // ...the bridge's log is listening before React hydrates...
    const log = installPageLog(window);
    // ...and the quick preview's document takes the server's markup out.
    runQuickPreviewRenderScript();

    // The new code: a darker hero, the same text.
    await act(async () => {
      root = hydrateRoot(document, <Page heading="Dette er så gøy" dark />);
    });

    // The new code is what is on the page...
    expect(document.querySelector("section")?.className).toBe(
      "bg-black text-white",
    );
    expect(document.querySelector("h1")?.textContent).toBe("Dette er så gøy");
    // ...and nothing went wrong on it.
    expect(loggedErrors(log)).toEqual([]);
  });

  test("a quick preview of the page as it was logs no error either", async () => {
    // No change at all: whatever is logged is the quick preview's own.
    serverDocument(
      renderToString(<Page heading="Dette er så gøy" dark={false} />),
    );
    const log = installPageLog(window);
    runQuickPreviewRenderScript();

    await act(async () => {
      root = hydrateRoot(
        document,
        <Page heading="Dette er så gøy" dark={false} />,
      );
    });

    expect(document.querySelector("h1")?.textContent).toBe("Dette er så gøy");
    expect(loggedErrors(log)).toEqual([]);
  });

  /**
   * The other side: a page whose own code renders something on the server
   * that it does not render in the browser has a real hydration bug, and a
   * page check has to keep hearing about it. Whatever makes the quick
   * preview quiet must not do it by not listening.
   */
  test("a page that is not a quick preview still logs its own hydration mismatch", async () => {
    serverDocument(renderToString(<Page heading="Server" dark={false} />));
    const log = installPageLog(window);

    await act(async () => {
      root = hydrateRoot(document, <Page heading="Browser" dark={false} />);
    });

    expect(loggedErrors(log)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Hydration failed/)]),
    );
  });
});
