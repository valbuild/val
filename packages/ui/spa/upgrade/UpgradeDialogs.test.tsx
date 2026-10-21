/** @jest-environment jsdom */
import "../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import { UpgradeChooser } from "./UpgradeChooser";
import { UpgradeProgressDialog } from "./UpgradeProgressDialog";
import type { UpgradeProgressView } from "./upgradeProgress";
import type { UpgradeCheckState } from "./useUpgradeCheck";

/*
 * The Upgrade (valbuild/home `docs/adept.md`, step 7): which kind, and an
 * upgrade proposal followed to Publish (decision 20).
 */
const CHECKED: UpgradeCheckState = {
  status: "checked",
  at: 0,
  check: {
    state: "checked",
    checkedAt: "2026-10-21T10:00:00.000Z",
    available: true,
    cves: {
      vulnerable: 1,
      severity: "high",
      packages: [{ name: "lodash", version: "4.17.20", severity: "high" }],
    },
    latest: { packages: [{ name: "zod", from: "3.0.0", to: "3.9.0" }] },
    majors: {
      packages: [
        { name: "react", from: "18.3.1", to: "19.2.0" },
        { name: "vite", from: "6.0.0", to: "7.1.0" },
      ],
    },
  },
};

describe("choosing an upgrade", () => {
  test("a vulnerability fix is offered first, and opens a proposal for it", () => {
    const onStart = jest.fn();
    render(
      <UpgradeChooser
        check={CHECKED}
        start={{ status: "idle" }}
        onStart={onStart}
        onRecheck={() => {}}
      />,
    );
    expect(screen.getByText("lodash")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /upgrade in a proposal/i }),
    );
    expect(onStart).toHaveBeenCalledWith("cves", []);
  });

  test("majors are each a box: one left out is skipped", () => {
    const onStart = jest.fn();
    render(
      <UpgradeChooser
        check={CHECKED}
        start={{ status: "idle" }}
        onStart={onStart}
        onRecheck={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "New major versions" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Upgrade react" }));
    fireEvent.click(
      screen.getByRole("button", { name: /upgrade in a proposal/i }),
    );
    expect(onStart).toHaveBeenCalledWith("majors", ["react"]);
  });

  test("a kind with nothing to do cannot be chosen", () => {
    render(
      <UpgradeChooser
        check={{
          ...CHECKED,
          check: {
            state: "checked",
            checkedAt: "x",
            available: true,
            cves: { vulnerable: 0, severity: null, packages: [] },
            latest: { packages: [{ name: "zod", from: "3.0.0", to: "3.9.0" }] },
            majors: { packages: [] },
          },
        }}
        start={{ status: "idle" }}
        onStart={() => {}}
        onRecheck={() => {}}
      />,
    );
    expect(
      screen
        .getByRole("radio", { name: "Fix vulnerabilities" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("radio", { name: "Latest within the major" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  test("a check that failed says so, and Try again asks again", () => {
    const onRecheck = jest.fn();
    render(
      <UpgradeChooser
        check={{ status: "failed", message: "Val Build answered 502." }}
        start={{ status: "idle" }}
        onStart={() => {}}
        onRecheck={onRecheck}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Val Build answered 502.",
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  test("a proposal that could not be opened says why, and the button tries again", () => {
    const onStart = jest.fn();
    render(
      <UpgradeChooser
        check={CHECKED}
        start={{ status: "failed", message: "Proposals are off." }}
        onStart={onStart}
        onRecheck={() => {}}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Proposals are off.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: /upgrade in a proposal/i }),
    );
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

const view = (
  over: Partial<UpgradeProgressView> = {},
): UpgradeProgressView => ({
  upgrade: {
    path: "majors",
    state: "staged",
    changes: [{ name: "react", from: "18.3.1", to: "19.2.0", kind: "major" }],
    vulnerableBefore: null,
    vulnerableAfter: null,
    error: null,
  },
  dependencies: { state: "done", detail: null },
  typecheck: {
    state: "done",
    newErrors: 0,
    errors: [],
    detail: null,
    retryable: true,
  },
  build: { state: "done", detail: null },
  canPublish: true,
  ...over,
});

const progress = (
  v: UpgradeProgressView,
  handlers: Partial<{
    onComputeLockfile: () => void;
    onTypecheck: () => void;
    onBuild: () => void;
    onPublish: () => void;
  }> = {},
) =>
  render(
    <UpgradeProgressDialog
      open
      onOpenChange={() => {}}
      displayName="Upgrade to new major versions"
      view={v}
      onComputeLockfile={handlers.onComputeLockfile ?? (() => {})}
      onTypecheck={handlers.onTypecheck ?? (() => {})}
      onBuild={handlers.onBuild ?? (() => {})}
      onPublish={handlers.onPublish ?? (() => {})}
    />,
  );

describe("an upgrade, followed to Publish", () => {
  test("no new errors and built: Publish", () => {
    const onPublish = jest.fn();
    progress(view(), { onPublish });
    expect(screen.getByText("0 new type errors")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  test("new errors are listed by file, Publish waits, and Typecheck again is offered", () => {
    const onTypecheck = jest.fn();
    progress(
      view({
        typecheck: {
          state: "done",
          newErrors: 2,
          errors: [
            {
              file: "src/b.tsx",
              line: 4,
              column: 2,
              code: 2322,
              message: "Type 'x' is not assignable",
            },
            {
              file: "src/a.tsx",
              line: 9,
              column: 5,
              code: 2339,
              message: "Property 'y' does not exist",
            },
          ],
          detail: null,
          retryable: true,
        },
        canPublish: false,
      }),
      { onTypecheck },
    );
    expect(screen.getByText(/2 new type errors/)).toBeTruthy();
    expect(screen.getByText("src/a.tsx")).toBeTruthy();
    expect(screen.getByText("src/b.tsx")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /publish/i }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /typecheck again/i }));
    expect(onTypecheck).toHaveBeenCalledTimes(1);
  });

  test("a lockfile that does not match offers to compute it", () => {
    const onComputeLockfile = jest.fn();
    progress(
      view({
        dependencies: { state: "lockfile", detail: null },
        typecheck: {
          state: "waiting",
          newErrors: null,
          errors: [],
          detail: null,
          retryable: false,
        },
        canPublish: false,
      }),
      { onComputeLockfile },
    );
    fireEvent.click(screen.getByRole("button", { name: /compute lockfile/i }));
    expect(onComputeLockfile).toHaveBeenCalledTimes(1);
  });

  test("not built yet: Build is offered", () => {
    const onBuild = jest.fn();
    progress(
      view({ build: { state: "required", detail: null }, canPublish: false }),
      { onBuild },
    );
    fireEvent.click(screen.getByRole("button", { name: /^build$/i }));
    expect(onBuild).toHaveBeenCalledTimes(1);
  });

  test("an upgrade adept could not compute says why, and nothing after it is shown", () => {
    progress(
      view({
        upgrade: {
          path: "cves",
          state: "failed",
          changes: [],
          vulnerableBefore: null,
          vulnerableAfter: null,
          error: "No fix is strictly better",
        },
        canPublish: false,
      }),
    );
    expect(screen.getByText(/No fix is strictly better/)).toBeTruthy();
    expect(screen.queryByText(/Typecheck/)).toBeNull();
  });
});
