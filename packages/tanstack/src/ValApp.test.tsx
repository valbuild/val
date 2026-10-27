/**
 * @jest-environment jsdom
 */
import { initVal } from "@valbuild/core";
import { VAL_APP_ID } from "@valbuild/ui";
import type { ReactNode } from "react";

// Injecting the Studio's script is not what this is about, and jsdom has no
// `CSS.escape` for `ValScript` to build its selector with.
jest.mock("./ValScript", () => ({ ValScript: () => null }));

/**
 * The Studio's loading screen has to stay up until the Studio can be seen.
 *
 * It used to be rendered instead of the Studio and dropped as soon as the page
 * hydrated -- before the Studio's script was even requested -- so opening the
 * Studio was a spinner, then an empty page for as long as the Studio took to
 * download, then the Studio. The empty page is what read as a flash.
 */
describe("ValApp's loading screen", () => {
  const { config } = initVal({ project: "acme/site", defaultTheme: "dark" });
  const spinner = () => document.querySelector("svg path");
  const cssLoaded = () =>
    act(() => {
      window.dispatchEvent(new CustomEvent("val-css-loaded"));
    });
  // Whether the styles have loaded is the page's, so each test is a new page:
  // a fresh module registry, and React and the renderers from that same one.
  let ValApp: typeof import("./ValApp").ValApp;
  let act: typeof import("@testing-library/react/pure").act;
  let render: typeof import("@testing-library/react/pure").render;
  let hydrateRoot: typeof import("react-dom/client").hydrateRoot;
  let renderToString: typeof import("react-dom/server").renderToString;
  let unmountAll: () => void = () => undefined;
  afterEach(() => unmountAll());
  beforeEach(async () => {
    jest.resetModules();
    ({ ValApp } = await import("./ValApp"));
    // `pure`: the default entry registers hooks on import, which a test cannot.
    let cleanup: () => void;
    ({ act, render, cleanup } = await import("@testing-library/react/pure"));
    unmountAll = cleanup;
    ({ hydrateRoot } = await import("react-dom/client"));
    ({ renderToString } = await import("react-dom/server"));
    document.body.innerHTML = "";
  });

  test("is up from the first render, and the Studio starts loading under it", () => {
    render(<ValApp config={config} />);
    expect(spinner()).not.toBeNull();
    expect(document.getElementById(VAL_APP_ID)).not.toBeNull();
  });

  test("stays up after the page has hydrated, until the Studio's styles have loaded", () => {
    render(<ValApp config={config} />);
    expect(spinner()).not.toBeNull();
    cssLoaded();
    expect(spinner()).toBeNull();
    expect(document.getElementById(VAL_APP_ID)).not.toBeNull();
  });

  test("covers the page rather than taking its place", () => {
    render(<ValApp config={config} />);
    expect(spinner()?.closest("div")?.style.position).toBe("fixed");
  });

  test("is the element the server rendered: hydration keeps it, it does not restart", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<ValApp config={config} />);
    document.body.appendChild(container);
    const served = spinner()?.closest("div");
    expect(served).not.toBeNull();
    await act(async () => {
      hydrateRoot(container, <ValApp config={config} />);
    });
    expect(document.getElementById(VAL_APP_ID)).not.toBeNull();
    expect(spinner()?.closest("div")).toBe(served);
  });

  test("never covers the page for good: a Studio whose styles never load is shown after the wait", () => {
    jest.useFakeTimers();
    try {
      render(<ValApp config={config} />);
      act(() => {
        jest.advanceTimersByTime(15_000);
      });
      expect(spinner()).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test("does not come back once the styles have loaded: not for a new config, not on mounting again", () => {
    const { rerender, unmount } = render(<ValApp config={config} />);
    cssLoaded();
    rerender(<ValApp config={{ ...config }} />);
    expect(spinner()).toBeNull();
    unmount();
    render(<ValApp config={config} />);
    expect(spinner()).toBeNull();
  });
});

/**
 * The demo starts Val's server in the tab, and that server needs the project's
 * modules, which `<ValModulesClient>` registers from inside `<ValApp>`.
 *
 * `ValApp` renders only its loading screen at first, so the child that
 * registers them is not mounted yet. The demo used to start on that first
 * render, and read the modules once the server's code had loaded: on a page
 * that had the code already, that was before the child's next render, and the
 * demo said it "was built without its content" -- some of the time, on the
 * same build.
 *
 * Rendered without `act`, which would do React's follow-up render on the spot
 * and hide exactly the race this is about. In a browser it is a task of its
 * own, and a module that has already loaded resolves before it.
 */
describe("ValApp's demo", () => {
  const { s, c, config } = initVal({ project: "acme/site" });
  const modules = {
    config,
    modules: [
      {
        def: async () => ({
          default: c.define("/content/a.val.ts", s.string(), "a"),
        }),
      },
    ],
  };
  const settled = () => new Promise((resolve) => setTimeout(resolve, 100));
  const alert = () => document.querySelector('[role="alert"]');
  let ValApp: typeof import("./ValApp").ValApp;
  let ValModulesClient: typeof import("./ValModulesClient").ValModulesClient;
  let createRoot: typeof import("react-dom/client").createRoot;
  let unmount: () => void = () => undefined;
  afterEach(() => {
    unmount();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });
  beforeEach(async () => {
    jest.resetModules();
    // The server's code has loaded already: the import resolves at once.
    jest.doMock("@valbuild/server/browser", () => ({
      createInTabValFetch: () => async () => new Response(null),
    }));
    jest.doMock("./demo/demoRelayHost", () => ({
      startDemoRelay: async () => true,
    }));
    ({ ValApp } = await import("./ValApp"));
    ({ ValModulesClient } = await import("./ValModulesClient"));
    ({ createRoot } = await import("react-dom/client"));
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
    document.body.innerHTML = "";
    delete window.__VAL_MODULES__;
    delete window.__VAL_DEMO__;
  });

  function renderDemo(children?: ReactNode) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(
      <ValApp config={{ ...config, defaultTheme: "light" }} demo>
        {children}
      </ValApp>,
    );
    unmount = () => root.unmount();
  }

  test("starts with the modules its child registers, however fast the server's code loads", async () => {
    renderDemo(<ValModulesClient modules={modules} />);
    await settled();
    expect(alert()).toBeNull();
    expect(window.__VAL_DEMO__).toBeDefined();
  });

  test("says it was built without its content when nothing registers any", async () => {
    renderDemo();
    await settled();
    expect(alert()?.textContent).toContain("built without its content");
    expect(window.__VAL_DEMO__).toBeUndefined();
  });
});
