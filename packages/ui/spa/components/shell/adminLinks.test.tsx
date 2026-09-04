/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel";
import { TopBar } from "./TopBar";
import { ShellAdminLinks } from "./types";

/**
 * The ways from the Studio to the project in Val Build.
 *
 * Val edits content; members, keys and the subscription live in the admin app,
 * and there was no way to get from one to the other. There is now the project
 * name in the top bar and two rows in Settings — all three hang off the same
 * `admin` links, which are absent for a project that is not connected. What is
 * pinned here is that absence: a link to a project page that does not exist is
 * worse than no link, since it lands on a sign-in for an organisation the
 * editor may not be in.
 */

const admin: ShellAdminLinks = {
  project: "https://admin.val.build/~/acme/marketing-site",
  members: "https://admin.val.build/manage-members/acme",
};

function topBar(projectHref?: string) {
  return (
    <TopBar
      breakpoint="desktop"
      projectName="acme/marketing-site"
      projectHref={projectHref}
      openPanel={null}
      onTogglePanel={() => undefined}
      onOpenMenu={() => undefined}
      onOpenSearch={() => undefined}
      onPreview={() => undefined}
      isCanvasOpen={false}
      onPublish={() => undefined}
      pendingChanges={0}
    />
  );
}

function settingsPanel(links?: ShellAdminLinks) {
  return (
    <SettingsPanel
      breakpoint="desktop"
      theme="dark"
      onThemeChange={() => undefined}
      admin={links}
      autoSave={false}
      onAutoSaveChange={() => undefined}
      onClose={() => undefined}
    />
  );
}

describe("the project name in the top bar", () => {
  test("opens the project in Val Build, in a new tab", () => {
    render(topBar(admin.project));
    const link = screen.getByRole("link", { name: "acme/marketing-site" });
    expect(link.getAttribute("href")).toBe(admin.project);
    // Leaving the Studio means leaving whatever is being edited in it.
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  test("is a plain label when the project is not connected", () => {
    render(topBar(undefined));
    expect(
      screen.queryByRole("link", { name: "acme/marketing-site" }),
    ).toBeNull();
    expect(screen.getByText("acme/marketing-site")).not.toBeNull();
  });
});

describe("the project section in Settings", () => {
  test("offers the project's page and the org's members", () => {
    render(settingsPanel(admin));
    expect(
      screen
        .getByRole("link", { name: /Administer project/ })
        .getAttribute("href"),
    ).toBe(admin.project);
    expect(
      screen.getByRole("link", { name: /Manage members/ }).getAttribute("href"),
    ).toBe(admin.members);
  });

  test("is not there at all when the project is not connected", () => {
    render(settingsPanel(undefined));
    expect(
      screen.queryByRole("link", { name: /Administer project/ }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /Manage members/ })).toBeNull();
    // The rest of the panel is untouched — this hides one section.
    expect(screen.getByText("Appearance")).not.toBeNull();
  });
});
