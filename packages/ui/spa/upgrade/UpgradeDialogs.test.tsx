/** @jest-environment jsdom */
import "../stores/react/testPolyfills";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { UpgradeChooser } from "./UpgradeChooser";
import { UpgradeProgressDialog } from "./UpgradeProgressDialog";
import { upgradeFooterOf, type UpgradeProgressView } from "./upgradeProgress";
import type { PublishProposalState } from "../components/proposals/PublishProposalDialog";
import type { UpgradeCheckState } from "./useUpgradeCheck";

/*
 * The Upgrade (valbuild/home `docs/adept.md`, step 7): which kind, and an
 * upgrade proposal followed in one dialog to Go to site (decision 20).
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
  build: { state: "done", detail: null, percent: null },
  canPublish: true,
  ...over,
});

const READY: PublishProposalState = {
  kind: "ready",
  checks: [
    { id: "site-code", ok: true, message: "The site's code is as it was." },
  ],
  changes: 2,
  unsaved: 0,
};

type Handlers = {
  onComputeLockfile: () => void;
  onTypecheck: () => void;
  onBuild: () => void;
  onPublish: () => void;
  onRetryPublish: () => void;
  onReview: () => void;
  onGoToSite: () => void;
};

/** The dialog, with the footer it derives from the view and the publish. */
const progress = (
  v: UpgradeProgressView | null,
  publish: PublishProposalState = READY,
  handlers: Partial<Handlers> = {},
) =>
  render(
    <UpgradeProgressDialog
      open
      onOpenChange={() => {}}
      displayName={v === null ? null : "Upgrade to new major versions"}
      view={v}
      publish={publish}
      footer={upgradeFooterOf(v, publish)}
      onComputeLockfile={handlers.onComputeLockfile ?? (() => {})}
      onTypecheck={handlers.onTypecheck ?? (() => {})}
      onBuild={handlers.onBuild ?? (() => {})}
      onPublish={handlers.onPublish ?? (() => {})}
      onRetryPublish={handlers.onRetryPublish ?? (() => {})}
      onReview={handlers.onReview ?? (() => {})}
      onGoToSite={handlers.onGoToSite ?? (() => {})}
    />,
  );

/** The footer's one button, where Publish is. */
const footerButton = () =>
  within(screen.getByRole("group", { name: "Next step" })).getByRole("button");

describe("an upgrade, in one dialog to Go to site", () => {
  test("open before the proposal is read: it says it is loading, and Publish waits", () => {
    progress(null, { kind: "checking" });
    expect(screen.getAllByText(/Loading the upgrade/).length).toBeGreaterThan(
      0,
    );
    expect(footerButton().textContent).toMatch(/Publish/);
    expect(footerButton().hasAttribute("disabled")).toBe(true);
  });

  test("built, no new errors, and the checks pass: one press publishes", () => {
    const onPublish = jest.fn();
    progress(view(), READY, { onPublish });
    expect(screen.getByText("Typechecked: 0 new type errors")).toBeTruthy();
    expect(screen.getByText("Built, and no new type errors.")).toBeTruthy();
    fireEvent.click(footerButton());
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  test("new errors are listed by file, and Publish waits until they are fixed", () => {
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
    );
    expect(screen.getByText(/2 new type errors/)).toBeTruthy();
    expect(screen.getByText("src/a.tsx")).toBeTruthy();
    expect(screen.getByText("src/b.tsx")).toBeTruthy();
    expect(
      screen.getByText(/stays open until the new type errors/),
    ).toBeTruthy();
    expect(footerButton().hasAttribute("disabled")).toBe(true);
  });

  test("a lockfile that does not match: the footer computes it", () => {
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
      READY,
      { onComputeLockfile },
    );
    fireEvent.click(screen.getByRole("button", { name: /compute lockfile/i }));
    expect(onComputeLockfile).toHaveBeenCalledTimes(1);
  });

  test("building: it says which step, how far, and Publish waits for it", () => {
    progress(
      view({
        build: { state: "running", detail: "Uploading 41 of 112", percent: 40 },
        canPublish: false,
      }),
    );
    expect(screen.getByText("Building… Uploading 41 of 112")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "40",
    );
    expect(screen.getByText("Publish waits for the build.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^build$/i })).toBeNull();
  });

  test("a build that failed says why, and Try again is where Publish is", () => {
    const onBuild = jest.fn();
    progress(
      view({
        build: {
          state: "failed",
          detail: "The proposals API answered 524.",
          percent: null,
        },
        canPublish: false,
      }),
      READY,
      { onBuild },
    );
    expect(screen.getByText("The proposals API answered 524.")).toBeTruthy();
    expect(footerButton().textContent).toMatch(/Try again/);
    fireEvent.click(footerButton());
    expect(onBuild).toHaveBeenCalledTimes(1);
  });

  test("where the browser opens the builder tab only from a tap, the footer asks for it", () => {
    const onBuild = jest.fn();
    progress(
      view({
        build: { state: "tap", detail: null, percent: null },
        canPublish: false,
      }),
      READY,
      { onBuild },
    );
    expect(screen.getByText(/the build runs in a new tab/)).toBeTruthy();
    fireEvent.click(footerButton());
    expect(onBuild).toHaveBeenCalledTimes(1);
  });

  test("publishing: it says so, and nothing can be pressed twice", () => {
    progress(view(), { kind: "publishing", step: "publishing" });
    expect(screen.getAllByText("Publishing…").length).toBeGreaterThan(0);
    expect(footerButton().hasAttribute("disabled")).toBe(true);
  });

  test("a publish that failed says why, and Try again publishes again", () => {
    const onRetryPublish = jest.fn();
    progress(
      view(),
      { kind: "failed", message: "The site moved on" },
      { onRetryPublish },
    );
    expect(
      screen.getByText(/It was not published: The site moved on\./),
    ).toBeTruthy();
    fireEvent.click(footerButton());
    expect(onRetryPublish).toHaveBeenCalledTimes(1);
  });

  test("published: Go to site is the last press", () => {
    const onGoToSite = jest.fn();
    progress(view(), { kind: "merged" }, { onGoToSite });
    expect(
      screen.getByText("Published. The site runs the upgrade."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /go to site/i }));
    expect(onGoToSite).toHaveBeenCalledTimes(1);
  });

  test("a check only the Publish dialog can clear leads there", () => {
    const onReview = jest.fn();
    progress(
      view(),
      {
        ...READY,
        checks: [
          {
            id: "site-code",
            ok: false,
            message: "The site's code changed since this proposal started",
            action: "update-from-site",
          },
        ],
      },
      { onReview },
    );
    fireEvent.click(screen.getByRole("button", { name: /review/i }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  test("an upgrade adept could not compute says why, nothing after it is shown, and it can be closed", () => {
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
    expect(footerButton().textContent).toMatch(/Close/);
  });
});
