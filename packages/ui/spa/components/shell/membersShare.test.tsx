/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";
import { MembersShare, orgOfProject } from "./MembersShare";
import { ShellBreakpoint } from "./types";

/**
 * Val Build's Share button, `<val-members>`, in the top bar of a connected
 * project. jsdom never defines the element, so these are also the Studio
 * that could not reach admin.val.build: what it shows is the fallback link.
 */

const MEMBERS_HREF = "https://admin.val.build/manage-members/acme";
const WC = "https://admin.val.build/wc/v1";

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

test("a connected project gets Share, with a link to its members as the fallback", () => {
  const { container } = render(
    topBar({ membersHref: MEMBERS_HREF, webComponentsUrl: WC }),
  );
  const element = container.querySelector("val-members");
  expect(element?.getAttribute("org")).toBe("acme");
  expect(element?.getAttribute("api-base")).toBe("/api/val/admin/proxy");
  expect(element?.getAttribute("layout")).toBe("popover");
  expect(element?.getAttribute("trigger")).toBe("button");
  const link = screen.getByRole("link", { name: "Share" });
  expect(element?.contains(link)).toBe(true);
  expect(link.getAttribute("href")).toBe(MEMBERS_HREF);
  expect(
    document.head.querySelector(`script[src="${WC}/members.js"]`),
  ).not.toBeNull();
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
  expect(element?.getAttribute("trigger")).toBe("icon");
  expect(element?.getAttribute("layout")).toBe("sheet");
  expect(screen.getByRole("link", { name: "Share acme" })).not.toBeNull();
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
