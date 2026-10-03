/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";
import { ProjectSwitcher, loadWebComponentScript } from "./ProjectSwitcher";

/**
 * The top bar's project name, for a connected project: the Studio's own
 * button, with Val Build's switcher (`<val-project-switcher trigger="slot">`)
 * around it and loaded only when someone reaches for it.
 *
 * jsdom never defines the element, so the script "loads" here by the test's
 * own `loadScript` resolving — and the element stays undefined, which is also
 * the Studio whose script never arrived.
 */

const PROJECT_HREF = "https://admin.val.build/~/acme/marketing-site";
const WC = "https://admin.val.build/wc/v1";

let fetchMock: jest.Mock<Promise<Response>, Parameters<typeof fetch>>;
beforeEach(() => {
  fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>(() =>
    Promise.reject(new Error("no network in tests")),
  );
  Object.defineProperty(globalThis, "fetch", {
    value: fetchMock,
    configurable: true,
    writable: true,
  });
});

function topBar(props: {
  projectName?: string;
  projectHref?: string;
  webComponentsUrl?: string;
}) {
  return (
    <TopBar
      breakpoint="desktop"
      projectName={props.projectName ?? "acme/marketing-site"}
      openPanel={null}
      onTogglePanel={() => undefined}
      onOpenMenu={() => undefined}
      onOpenSearch={() => undefined}
      onPreview={() => undefined}
      isCanvasOpen={false}
      onPublish={() => undefined}
      pendingChanges={0}
      projectHref={props.projectHref}
      webComponentsUrl={props.webComponentsUrl}
    />
  );
}

function switcher(loadScript: (src: string) => Promise<void>) {
  return render(
    <ProjectSwitcher
      projectName="acme/site"
      projectHref={PROJECT_HREF}
      webComponentsUrl={WC}
      breakpoint="desktop"
      loadScript={loadScript}
    />,
  );
}

describe("in the top bar", () => {
  test("a connected project gets the Studio's button, inside the switcher, and loads nothing yet", () => {
    const scripts = () =>
      document.head.querySelectorAll("script[data-val-web-component]").length;
    const before = scripts();
    const { container } = render(
      topBar({
        projectName: "acme/recorded",
        projectHref: PROJECT_HREF,
        webComponentsUrl: WC,
      }),
    );
    const element = container.querySelector("val-project-switcher");
    expect(element?.getAttribute("project")).toBe("acme/recorded");
    expect(element?.getAttribute("trigger")).toBe("slot");
    expect(element?.getAttribute("api-base")).toBe("/api/val/admin/proxy");
    expect(element?.getAttribute("admin-url")).toBe(PROJECT_HREF);
    expect(element?.getAttribute("layout")).toBe("popover");
    // The name alone, as a button: the same before and after the script.
    const button = screen.getByRole("button", { name: "recorded" });
    expect(element?.contains(button)).toBe(true);
    expect(button.getAttribute("title")).toBe("acme/recorded");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(scripts()).toBe(before);
    // The visit goes to the top of Recent, without the component.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/val/admin/proxy/projects/opened?project=acme%2Frecorded",
      { method: "POST", headers: { "x-val-studio": "1" } },
    );
  });

  test("a project that is not connected keeps its plain name, and loads nothing", () => {
    const scripts = () =>
      document.head.querySelectorAll("script[data-val-web-component]").length;
    const before = scripts();
    const { container } = render(topBar({}));
    expect(container.querySelector("val-project-switcher")).toBeNull();
    expect(screen.getByText("acme/marketing-site")).not.toBeNull();
    expect(scripts()).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

test("hovering the name fetches the script, before anyone clicks", () => {
  const loadScript = jest.fn(() => Promise.resolve());
  switcher(loadScript);
  expect(loadScript).not.toHaveBeenCalled();
  fireEvent.pointerEnter(screen.getByRole("button", { name: "site" }));
  expect(loadScript).toHaveBeenCalledWith(`${WC}/project-switcher.js`);
});

test("the first click asks the component to open, and loads it", () => {
  const loadScript = jest.fn(() => new Promise<void>(() => undefined));
  const { container } = switcher(loadScript);
  fireEvent.click(screen.getByRole("button", { name: "site" }));
  expect(loadScript).toHaveBeenCalledWith(`${WC}/project-switcher.js`);
  expect(
    container.querySelector("val-project-switcher")?.hasAttribute("open"),
  ).toBe(true);
});

test("a script that cannot load sends the click to Val Build instead", async () => {
  const open = jest.spyOn(window, "open").mockImplementation(() => null);
  const { container } = switcher(() => Promise.reject(new Error("blocked")));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "site" }));
  });
  expect(open).toHaveBeenCalledWith(
    PROJECT_HREF,
    "_blank",
    "noopener,noreferrer",
  );
  expect(
    container.querySelector("val-project-switcher")?.hasAttribute("open"),
  ).toBe(false);
  open.mockRestore();
});

test("the button shows the panel as open while the component says it is", () => {
  const { container } = switcher(() => Promise.resolve());
  const element = container.querySelector("val-project-switcher");
  const button = screen.getByRole("button", { name: "site" });
  act(() => {
    element?.dispatchEvent(
      new CustomEvent("val-open-change", { detail: { open: true } }),
    );
  });
  expect(button.getAttribute("aria-expanded")).toBe("true");
  act(() => {
    element?.dispatchEvent(
      new CustomEvent("val-open-change", { detail: { open: false } }),
    );
  });
  expect(button.getAttribute("aria-expanded")).toBe("false");
});

test("tells the component where the Studio runs, so it knows what signing in again means", () => {
  const { container } = render(
    <ProjectSwitcher
      projectName="acme/site"
      projectHref={PROJECT_HREF}
      webComponentsUrl={WC}
      studioMode="fs"
      breakpoint="desktop"
      loadScript={() => Promise.resolve()}
    />,
  );
  expect(
    container.querySelector("val-project-switcher")?.getAttribute("mode"),
  ).toBe("fs");
});

test("a phone gets the sheet layout", () => {
  const { container } = render(
    <ProjectSwitcher
      projectName="acme/site"
      projectHref={PROJECT_HREF}
      webComponentsUrl={WC}
      breakpoint="mobile"
      loadScript={() => Promise.resolve()}
    />,
  );
  expect(
    container.querySelector("val-project-switcher")?.getAttribute("layout"),
  ).toBe("sheet");
});

describe("loadWebComponentScript", () => {
  test("adds one script per source, however many mount", () => {
    void loadWebComponentScript(`${WC}/a.js`);
    void loadWebComponentScript(`${WC}/a.js`);
    expect(
      document.head.querySelectorAll(`script[src="${WC}/a.js"]`),
    ).toHaveLength(1);
  });

  test("forgets a failed load, so the next mount tries again", async () => {
    const first = loadWebComponentScript(`${WC}/b.js`);
    const script = document.head.querySelector<HTMLScriptElement>(
      `script[src="${WC}/b.js"]`,
    );
    script?.onerror?.(new Event("error"));
    await expect(first).rejects.toThrow("Could not load");
    expect(document.head.querySelector(`script[src="${WC}/b.js"]`)).toBeNull();
    void loadWebComponentScript(`${WC}/b.js`);
    expect(
      document.head.querySelectorAll(`script[src="${WC}/b.js"]`),
    ).toHaveLength(1);
  });
});
