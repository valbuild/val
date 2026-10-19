/**
 * @jest-environment jsdom
 */
import { initVal } from "@valbuild/core";
import { VAL_APP_ID } from "@valbuild/ui";

// Injecting the Studio's script is not what this is about.
jest.mock("next/script", () => ({ __esModule: true, default: () => null }));

/**
 * The Studio's loading screen has to stay up until the Studio can be seen.
 *
 * The same as `@valbuild/tanstack`'s, which this is a near-copy of.
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
