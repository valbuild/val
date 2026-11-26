/**
 * @jest-environment jsdom
 */
import React, { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  installPageLog,
  pageLogOf,
  type PageLog,
} from "@valbuild/shared/internal";
import { QuickPreviewRender } from "./QuickPreviewRender";

/**
 * A quick preview's page: what the new code makes of it, and what its log
 * says went wrong on it.
 *
 * Reported from code mode: every page check of a change failed on "React
 * minified error #418 (hydration mismatch, HTML text differing between server
 * and client)", which the check could not place -- "I could not tell from the
 * preview whether the change caused it or it was already there" -- and handed
 * to the assistant as a finding to fix.
 *
 * It was not the change, and not the site. A quick preview is the HTML the
 * LAST build's server rendered, run by the proposal's NEW code, and the new
 * code was made to hydrate it -- after the quick preview's worker had
 * emptied the body, so the old classes could not stay. React reported the
 * empty page as a hydration failure, an uncaught error, on every quick
 * preview.
 *
 * Now `ValProvider` wraps the site in `QuickPreviewRender` on a page opened
 * as a quick preview: rendered by the new code once the page has hydrated,
 * never hydrated itself, so nothing can fail to hydrate, and nothing is
 * filtered out of the log to get there. Everywhere else it is the children
 * as they are, so a real hydration bug is still heard.
 *
 * Driven as the browser runs it: the page server-rendered with the LAST
 * build's code (`renderToString`, with `QuickPreviewRender` where
 * `ValProvider` puts it), the page log the canvas bridge installs before
 * React runs (`installPageLog`), and the NEW code hydrating the whole
 * document, as TanStack Start does (`hydrateRoot(document, <StartClient />)`).
 * React and the DOM are the edge.
 */

/**
 * A site's page as TanStack Start renders it: `__root`'s document, with the
 * site inside `ValProvider` -- here only the part of it this is about.
 */
function Page({
  heading,
  dark,
  quickPreview,
  provider = true,
  onServer = false,
}: {
  heading: string;
  dark: boolean;
  quickPreview: boolean;
  /** `false`: an app from before `QuickPreviewRender`, for the why. */
  provider?: boolean;
  /** Rendered by the server: `serverDocument` says so. */
  onServer?: boolean;
}) {
  const site = (
    <main>
      <section className={dark ? "bg-black text-white" : "bg-white"}>
        <p>Eyebrow</p>
        <h1>{heading}</h1>
        <a href="/kontakt">Kontakt oss</a>
      </section>
    </main>
  );
  return (
    <html lang="no">
      <head>
        <title>Forside</title>
      </head>
      <body>
        {provider ? (
          <QuickPreviewRender quickPreview={quickPreview} onServer={onServer}>
            {site}
          </QuickPreviewRender>
        ) : (
          site
        )}
        <script dangerouslySetInnerHTML={{ __html: "window.$_TSR = {}" }} />
        <AtHydration />
      </body>
    </html>
  );
}

/**
 * What the page showed when hydration committed -- before any effect ran,
 * so before `QuickPreviewRender` replaced anything: the first frame the new
 * code is responsible for.
 */
let headingAtHydration: string | null = null;
function AtHydration() {
  React.useLayoutEffect(() => {
    headingAtHydration = document.querySelector("h1")?.textContent ?? null;
  }, []);
  return null;
}

/**
 * The document the server sent, as the browser has it before any script
 * runs: rendered with the LAST build's code, on the server.
 */
function serverDocument(page: React.ReactElement<{ onServer?: boolean }>) {
  const html = renderToString(React.cloneElement(page, { onServer: true }));
  // What a server render that could not finish leaves behind: never here.
  expect(html).not.toContain("<!--$!-->");
  document.documentElement.lang = "no";
  document.head.innerHTML = "<title>Forside</title>";
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
}

/** The errors the page log holds: what `read_page_log` hands the page check. */
function loggedErrors(log: PageLog) {
  return log
    .read({ levels: ["error"] })
    .entries.map((entry) => `${entry.source}: ${entry.text.split("\n")[0]}`);
}

describe("a quick preview's page", () => {
  let root: Root | null = null;

  beforeEach(() => {
    // Rendering inside `act`, as React asks a test environment to say.
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    pageLogOf(window)?.uninstall();
    jest.restoreAllMocks();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  /** The new code takes the page over, as the browser runs it. */
  async function hydrate(page: React.ReactElement) {
    await act(async () => {
      root = hydrateRoot(document, page);
    });
  }

  test("a change to classes is on the page, and nothing is logged", async () => {
    serverDocument(
      <Page heading="Dette er så gøy" dark={false} quickPreview />,
    );
    const log = installPageLog(window);

    await hydrate(<Page heading="Dette er så gøy" dark quickPreview />);

    expect(document.querySelectorAll("section")).toHaveLength(1);
    expect(document.querySelector("section")?.className).toBe(
      "bg-black text-white",
    );
    expect(loggedErrors(log)).toEqual([]);
  });

  test("a change to text is on the page, and nothing is logged", async () => {
    serverDocument(<Page heading="Gammel" dark={false} quickPreview />);
    const log = installPageLog(window);

    await hydrate(<Page heading="Ny" dark={false} quickPreview />);

    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent).toBe("Ny");
    expect(loggedErrors(log)).toEqual([]);
  });

  test("the page as it was, as a quick preview: nothing is logged", async () => {
    serverDocument(
      <Page heading="Dette er så gøy" dark={false} quickPreview />,
    );
    const log = installPageLog(window);

    await hydrate(<Page heading="Dette er så gøy" dark={false} quickPreview />);

    expect(document.querySelector("h1")?.textContent).toBe("Dette er så gøy");
    // The router's state, outside the site, is hydrated where it was.
    expect(document.body.querySelector("script")?.textContent).toBe(
      "window.$_TSR = {}",
    );
    expect(loggedErrors(log)).toEqual([]);
  });

  /**
   * Until the page has hydrated, the last build's page is on screen, never
   * an empty one: the quick preview used to empty the body before any of
   * the new code had run.
   */
  test("the old page is on screen until the new code replaces it", async () => {
    serverDocument(<Page heading="Gammel" dark={false} quickPreview />);
    installPageLog(window);
    headingAtHydration = null;

    await hydrate(<Page heading="Ny" dark={false} quickPreview />);

    // When the page had hydrated, the last build's page was there, whole...
    expect(headingAtHydration).toBe("Gammel");
    // ...and the new code replaced it in one commit: no frame between.
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent).toBe("Ny");
  });

  /**
   * The other side: a page that is not a quick preview whose own code
   * renders something on the server that it does not render in the browser
   * has a real hydration bug, and a page check has to keep hearing about it.
   * Whatever makes the quick preview quiet must not do it by not listening.
   */
  test("a page that is not a quick preview still logs its own hydration mismatch", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    serverDocument(<Page heading="Server" dark={false} quickPreview={false} />);
    const log = installPageLog(window);

    await hydrate(<Page heading="Browser" dark={false} quickPreview={false} />);

    expect(loggedErrors(log)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Hydration failed/)]),
    );
  });

  test("a page that is not a quick preview is the children as they are", () => {
    const html = renderToString(
      <Page heading="Hei" dark={false} quickPreview={false} />,
    );
    // No boundary: a visitor's page is the page it always was.
    expect(html).not.toContain("<!--$-->");
  });

  /**
   * Why: the new code hydrating the last build's markup. Text that differs
   * is a hydration failure the page logs as its own (React error 418 in a
   * production build) -- and emptying the body first, as the quick preview
   * did, made every quick preview one.
   */
  test("why: hydrating the last build's markup with the new code logs a hydration failure", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    serverDocument(
      <Page heading="Gammel" dark={false} quickPreview provider={false} />,
    );
    const log = installPageLog(window);

    await hydrate(
      <Page heading="Ny" dark={false} quickPreview provider={false} />,
    );

    expect(loggedErrors(log)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Hydration failed/)]),
    );
  });
});
