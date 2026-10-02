/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";
import { ProjectSwitcher, loadWebComponentScript } from "./ProjectSwitcher";

/**
 * The top bar's project name becomes Val Build's switcher for a connected
 * project, and stays what it was everywhere else.
 *
 * What matters most is the fallback: the switcher is a script from another
 * origin, and a Studio that cannot reach it (offline, a strict CSP) must still
 * show the project name and its link. jsdom never defines the element, which
 * is exactly that case — so these tests are the "script never loaded" Studio.
 */

const PROJECT_HREF = "https://admin.val.build/~/acme/marketing-site";
const WC = "https://admin.val.build/wc/v1";

function topBar(props: { projectHref?: string; webComponentsUrl?: string }) {
  return (
    <TopBar
      breakpoint="desktop"
      projectName="acme/marketing-site"
      openPanel={null}
      onTogglePanel={() => undefined}
      onOpenMenu={() => undefined}
      onOpenSearch={() => undefined}
      onPreview={() => undefined}
      isCanvasOpen={false}
      onPublish={() => undefined}
      pendingChanges={0}
      {...props}
    />
  );
}

describe("in the top bar", () => {
  test("a connected project gets the switcher, with today's link inside it as the fallback", () => {
    const { container } = render(
      topBar({ projectHref: PROJECT_HREF, webComponentsUrl: WC }),
    );
    const element = container.querySelector("val-project-switcher");
    expect(element?.getAttribute("project")).toBe("acme/marketing-site");
    expect(element?.getAttribute("api-base")).toBe("/api/val/admin/proxy");
    expect(element?.getAttribute("admin-url")).toBe(PROJECT_HREF);
    expect(element?.getAttribute("layout")).toBe("popover");
    // The element never upgrades here, so this is what an offline Studio shows.
    const link = screen.getByRole("link", { name: "acme/marketing-site" });
    expect(element?.contains(link)).toBe(true);
    expect(link.getAttribute("href")).toBe(PROJECT_HREF);

    // And it is loaded from the admin app. (Once per page: the loader keeps
    // the load, so only the first mount in this file adds the script.)
    const script = document.head.querySelector<HTMLScriptElement>(
      "script[data-val-web-component]",
    );
    expect(script?.src).toBe(`${WC}/project-switcher.js`);
    expect(script?.type).toBe("module");
  });

  test("a project that is not connected keeps its plain name, and loads nothing", () => {
    const scripts = () =>
      document.head.querySelectorAll("script[data-val-web-component]").length;
    const before = scripts();
    const { container } = render(topBar({}));
    expect(container.querySelector("val-project-switcher")).toBeNull();
    expect(screen.getByText("acme/marketing-site")).not.toBeNull();
    expect(scripts()).toBe(before);
  });
});

test("a phone gets the sheet layout", () => {
  const { container } = render(
    <ProjectSwitcher
      projectName="acme/site"
      projectHref={PROJECT_HREF}
      webComponentsUrl={WC}
      breakpoint="mobile"
      loadScript={() => Promise.resolve()}
    >
      site
    </ProjectSwitcher>,
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
