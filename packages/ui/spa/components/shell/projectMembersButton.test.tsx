/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";
import { ProjectMembersButton } from "./ProjectMembersButton";
import { ShellBreakpoint } from "./types";

/**
 * Members, in the top bar of a connected project: the Studio's own button,
 * with Val Build's `<val-project-members trigger="slot">` around it, loaded on
 * the first hover or click. jsdom never defines the element, so the script
 * "loads" by the test's `loadScript` resolving.
 */

// A project link also turns on the project switcher, which records the open
// with `fetch`: answered here, since jsdom has none.
beforeEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    value: jest.fn(() => Promise.reject(new Error("no network in tests"))),
    configurable: true,
    writable: true,
  });
});

const PROJECT_HREF = "https://admin.val.build/~/acme/marketing-site";
const MEMBERS_HREF = "https://admin.val.build/manage-members/acme";
const WC = "https://content.val.build/wc/v1";

function topBar(
  props: {
    projectHref?: string;
    webComponentsUrl?: string;
    projectName?: string;
    breakpoint?: ShellBreakpoint;
  } = {},
) {
  return (
    <TopBar
      breakpoint={props.breakpoint ?? "desktop"}
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
      membersHref={MEMBERS_HREF}
      webComponentsUrl={props.webComponentsUrl}
    />
  );
}

test("a connected project gets Members beside Share, and loads nothing yet", () => {
  const before = document.head.querySelectorAll(
    "script[data-val-web-component]",
  ).length;
  const { container } = render(
    topBar({ projectHref: PROJECT_HREF, webComponentsUrl: WC }),
  );
  const element = container.querySelector("val-project-members");
  expect(element?.getAttribute("project")).toBe("acme/marketing-site");
  expect(element?.getAttribute("api-base")).toBe("/api/val/admin/proxy");
  expect(element?.getAttribute("layout")).toBe("popover");
  expect(element?.getAttribute("trigger")).toBe("slot");
  const button = screen.getByRole("button", { name: "Members" });
  expect(element?.contains(button)).toBe(true);
  expect(button.getAttribute("aria-haspopup")).toBe("dialog");
  // Left of Share: the project's people, then the organization's.
  const share = container.querySelector("val-members");
  expect(
    element !== null &&
      share !== null &&
      element.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    document.head.querySelectorAll("script[data-val-web-component]").length,
  ).toBe(before);
});

test("the first click loads the panel and asks it to open", () => {
  const loadScript = jest.fn(() => new Promise<void>(() => undefined));
  const { container } = render(
    <ProjectMembersButton
      projectName="acme/marketing-site"
      projectHref={PROJECT_HREF}
      webComponentsUrl={WC}
      breakpoint="desktop"
      loadScript={loadScript}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Members" }));
  expect(loadScript).toHaveBeenCalledWith(`${WC}/project-members.js`);
  expect(
    container.querySelector("val-project-members")?.hasAttribute("open"),
  ).toBe(true);
});

test("a panel that cannot load opens the project's page in Val Build", async () => {
  const open = jest.spyOn(window, "open").mockImplementation(() => null);
  render(
    <ProjectMembersButton
      projectName="acme/marketing-site"
      projectHref={PROJECT_HREF}
      webComponentsUrl={WC}
      breakpoint="desktop"
      loadScript={() => Promise.reject(new Error("blocked"))}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Members" }));
  });
  expect(open).toHaveBeenCalledWith(
    PROJECT_HREF,
    "_blank",
    "noopener,noreferrer",
  );
  open.mockRestore();
});

test("on a phone it is an icon that opens a sheet", () => {
  const { container } = render(
    topBar({
      projectHref: PROJECT_HREF,
      webComponentsUrl: WC,
      breakpoint: "mobile",
    }),
  );
  const element = container.querySelector("val-project-members");
  expect(element?.getAttribute("layout")).toBe("sheet");
  expect(
    screen.getByRole("button", { name: "Members of marketing-site" }),
  ).not.toBeNull();
});

test("a project that is not connected gets no Members", () => {
  const { container } = render(topBar({ projectHref: PROJECT_HREF }));
  expect(container.querySelector("val-project-members")).toBeNull();
  const { container: other } = render(topBar({ webComponentsUrl: WC }));
  expect(other.querySelector("val-project-members")).toBeNull();
  const { container: unnamed } = render(
    topBar({
      projectHref: PROJECT_HREF,
      webComponentsUrl: WC,
      projectName: "marketing-site",
    }),
  );
  expect(unnamed.querySelector("val-project-members")).toBeNull();
});

test("tells the component where the Studio runs", () => {
  const { container } = render(
    <ProjectMembersButton
      projectName="acme/marketing-site"
      projectHref={PROJECT_HREF}
      webComponentsUrl={WC}
      studioMode="fs"
      breakpoint="desktop"
      loadScript={() => Promise.resolve()}
    />,
  );
  expect(
    container.querySelector("val-project-members")?.getAttribute("mode"),
  ).toBe("fs");
});
