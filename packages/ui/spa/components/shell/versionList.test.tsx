/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { VersionList } from "./VersionList";
import { ShellServerVersions, ShellVersions } from "./types";

/**
 * The versions at the foot of the account panel: one quiet line naming the
 * framework, which opens into what the server runs and what the tab loaded.
 */

const studio = { ui: "0.150.8", core: "0.150.3" };

function versions(
  loadServer: () => Promise<ShellServerVersions>,
): ShellVersions {
  return { studio, loadServer };
}

async function renderList(server: ShellServerVersions) {
  render(
    <VersionList
      versions={versions(() => Promise.resolve(server))}
      mode="fs"
    />,
  );
  // Let the server's answer land.
  await act(async () => {});
}

const tanstack: ShellServerVersions = {
  status: "success",
  framework: { name: "tanstack", version: "0.150.8" },
  core: "0.150.3",
  server: "0.150.8",
};

test("the closed line names the framework and its version", async () => {
  await renderList(tanstack);
  expect(
    screen.getByRole("button", { name: "TanStack · Val 0.150.8" }),
  ).toBeTruthy();
  expect(screen.queryByText("@valbuild/tanstack")).toBeNull();
});

test("opened, it lists the server's packages and the Studio's", async () => {
  await renderList(tanstack);
  fireEvent.click(screen.getByRole("button", { name: /TanStack/ }));
  expect(screen.getByText("@valbuild/tanstack")).toBeTruthy();
  expect(screen.getByText("@valbuild/server")).toBeTruthy();
  expect(screen.getByText("@valbuild/ui")).toBeTruthy();
  // Once for the server, once for the core bundled into the Studio.
  expect(screen.getAllByText("@valbuild/core")).toHaveLength(2);
  expect(screen.getByText("fs mode")).toBeTruthy();
});

test("Next.js is named as Next.js", async () => {
  await renderList({
    ...tanstack,
    framework: { name: "next", version: "0.150.7" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Next.js · Val 0.150.7" }),
  );
  expect(screen.getByText("@valbuild/next")).toBeTruthy();
});

test("an older server is said to be older, with nothing to retry", async () => {
  await renderList({ status: "unsupported" });
  fireEvent.click(screen.getByRole("button", { name: "Val 0.150.8" }));
  expect(screen.getByText(/older than the Studio/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  // The Studio's half does not depend on the server.
  expect(screen.getByText("@valbuild/ui")).toBeTruthy();
});

test("a failed request offers Try again, which asks again", async () => {
  const loadServer = jest
    .fn<Promise<ShellServerVersions>, []>()
    .mockResolvedValueOnce({ status: "error", message: "fetch failed" })
    .mockResolvedValueOnce(tanstack);
  render(<VersionList versions={versions(loadServer)} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Val 0.150.8" }));
  expect(screen.getByText("Could not get the server's versions.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await act(async () => {});
  expect(loadServer).toHaveBeenCalledTimes(2);
  expect(screen.getByText("@valbuild/tanstack")).toBeTruthy();
});
