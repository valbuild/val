/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";
import { MembersShare, orgOfProject } from "./MembersShare";
import { ShellBreakpoint } from "./types";

/**
 * Share, in the top bar of a connected project: the Studio's own button, with
 * Val Build's `<val-members trigger="slot">` around it, loaded on the first
 * hover or click. jsdom never defines the element, so the script "loads" by
 * the test's `loadScript` resolving.
 */

const MEMBERS_HREF = "https://admin.val.build/manage-members/acme";
const WC = "https://content.val.build/wc/v1";

function topBar(
  props: {
    membersHref?: string;
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
      membersHref={props.membersHref}
      webComponentsUrl={props.webComponentsUrl}
    />
  );
}

test("a connected project gets the Studio's Share button inside the members panel, and loads nothing yet", () => {
  const before = document.head.querySelectorAll(
    "script[data-val-web-component]",
  ).length;
  const { container } = render(
    topBar({ membersHref: MEMBERS_HREF, webComponentsUrl: WC }),
  );
  const element = container.querySelector("val-members");
  expect(element?.getAttribute("org")).toBe("acme");
  expect(element?.getAttribute("api-base")).toBe("/api/val/admin/proxy");
  expect(element?.getAttribute("layout")).toBe("popover");
  expect(element?.getAttribute("trigger")).toBe("slot");
  const button = screen.getByRole("button", { name: "Share" });
  expect(element?.contains(button)).toBe(true);
  expect(button.getAttribute("aria-haspopup")).toBe("dialog");
  expect(
    document.head.querySelectorAll("script[data-val-web-component]").length,
  ).toBe(before);
});

test("the first click loads the panel and asks it to open", () => {
  const loadScript = jest.fn(() => new Promise<void>(() => undefined));
  const { container } = render(
    <MembersShare
      org="acme"
      membersHref={MEMBERS_HREF}
      webComponentsUrl={WC}
      breakpoint="desktop"
      loadScript={loadScript}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(loadScript).toHaveBeenCalledWith(`${WC}/members.js`);
  expect(container.querySelector("val-members")?.hasAttribute("open")).toBe(
    true,
  );
});

test("a panel that cannot load opens the members page in Val Build", async () => {
  const open = jest.spyOn(window, "open").mockImplementation(() => null);
  render(
    <MembersShare
      org="acme"
      membersHref={MEMBERS_HREF}
      webComponentsUrl={WC}
      breakpoint="desktop"
      loadScript={() => Promise.reject(new Error("blocked"))}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
  });
  expect(open).toHaveBeenCalledWith(
    MEMBERS_HREF,
    "_blank",
    "noopener,noreferrer",
  );
  open.mockRestore();
});

test("above mobile it sits left of the locale menu", () => {
  const { container } = render(
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
      membersHref={MEMBERS_HREF}
      webComponentsUrl={WC}
      locales={["en", "nb"]}
      onLocaleChange={() => undefined}
    />,
  );
  const share = container.querySelector("val-members");
  const locale = screen.getByRole("button", { name: "Showing all languages" });
  expect(share).not.toBeNull();
  expect(
    share !== null &&
      share.compareDocumentPosition(locale) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("on a phone it is an icon that opens a sheet", () => {
  const { container } = render(
    topBar({
      membersHref: MEMBERS_HREF,
      webComponentsUrl: WC,
      breakpoint: "mobile",
    }),
  );
  const element = container.querySelector("val-members");
  expect(element?.getAttribute("trigger")).toBe("slot");
  expect(element?.getAttribute("layout")).toBe("sheet");
  expect(screen.getByRole("button", { name: "Share acme" })).not.toBeNull();
});

test("a project that is not connected gets no Share at all", () => {
  const { container } = render(topBar({ membersHref: MEMBERS_HREF }));
  expect(container.querySelector("val-members")).toBeNull();
  const { container: other } = render(topBar({ webComponentsUrl: WC }));
  expect(other.querySelector("val-members")).toBeNull();
});

test("tells the component where the Studio runs", () => {
  const { container } = render(
    <MembersShare
      org="acme"
      membersHref={MEMBERS_HREF}
      webComponentsUrl={WC}
      studioMode="fs"
      breakpoint="desktop"
      loadScript={() => Promise.resolve()}
    />,
  );
  expect(container.querySelector("val-members")?.getAttribute("mode")).toBe(
    "fs",
  );
});

test("orgOfProject reads org/name and nothing else", () => {
  expect(orgOfProject("acme/site")).toBe("acme");
  expect(orgOfProject("acme")).toBeNull();
  expect(orgOfProject("acme/site/extra")).toBeNull();
  expect(orgOfProject("/site")).toBeNull();
});
