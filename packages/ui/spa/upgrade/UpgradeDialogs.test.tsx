/** @jest-environment jsdom */
import "../stores/react/testPolyfills";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { UpgradeChooser } from "./UpgradeChooser";
import { UpgradeProgressPage } from "./UpgradeProgressPage";
import { upgradeFooterOf, type UpgradeProgressView } from "./upgradeProgress";
import type { PublishProposalState } from "../components/proposals/PublishProposalDialog";
import type { UpgradeCheckState } from "./useUpgradeCheck";

/*
 * The Upgrade (valbuild/home `docs/adept.md`, step 7): which kind, and an
 * upgrade proposal followed in its own tab to Go to site (decision 20).
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
      fixable: 2,
      severity: "high",
      packages: [{ name: "lodash", version: "4.17.20", severity: "high" }],
    },
    latest: {
      packages: [
        { name: "@valbuild/ui", from: "0.149.4", to: "0.150.0" },
        { name: "zod", from: "3.0.0", to: "3.9.0" },
      ],
      val: { from: "0.149.4", to: "0.150.0" },
    },
    majors: {
      packages: [
        { name: "react", from: "18.3.1", to: "19.2.0" },
        { name: "vite", from: "6.0.0", to: "7.1.0" },
      ],
    },
  },
};

describe("choosing an upgrade", () => {
  test("Minor versions is recommended, chosen first, and says which Val it moves to", () => {
    const onStart = jest.fn();
    render(
      <UpgradeChooser
        check={CHECKED}
        start={{ status: "idle" }}
        onStart={onStart}
        onRecheck={() => {}}
      />,
    );
    const minor = screen.getByRole("radio", { name: "Minor versions" });
    expect(minor.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("(recommended)")).toBeTruthy();
    expect(
      screen.getByText(
        "Val 0.149.4 → 0.150.0, and 1 dependency to the newest version of their major.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /create proposal/i }));
    expect(onStart).toHaveBeenCalledWith("latest", []);
  });

  test("Security fixes counts what it fixes, and opens a proposal for it", () => {
    const onStart = jest.fn();
    render(
      <UpgradeChooser
        check={CHECKED}
        start={{ status: "idle" }}
        onStart={onStart}
        onRecheck={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Security fixes" }));
    expect(
      screen.getByText(/^Fixes 2 vulnerabilities, the worst high/),
    ).toBeTruthy();
    expect(screen.getByText("lodash")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /create proposal/i }));
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
    fireEvent.click(screen.getByRole("radio", { name: "Full" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Upgrade react" }));
    fireEvent.click(screen.getByRole("button", { name: /create proposal/i }));
    expect(onStart).toHaveBeenCalledWith("majors", ["react"]);
  });

  test("a kind with nothing to move is not offered", () => {
    render(
      <UpgradeChooser
        check={{
          ...CHECKED,
          check: {
            state: "checked",
            checkedAt: "x",
            available: true,
            // Vulnerable, and nothing an upgrade can take fixes it.
            cves: {
              vulnerable: 1,
              fixable: 0,
              severity: "high",
              packages: [
                { name: "lodash", version: "4.17.20", severity: "high" },
              ],
            },
            latest: { packages: [{ name: "zod", from: "3.0.0", to: "3.9.0" }] },
            majors: { packages: [] },
          },
        }}
        start={{ status: "idle" }}
        onStart={() => {}}
        onRecheck={() => {}}
      />,
    );
    expect(screen.queryByRole("radio", { name: "Security fixes" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Full" })).toBeNull();
    expect(
      screen
        .getByRole("radio", { name: "Minor versions" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  test("vulnerable with no fix to take, and nothing else, says so", () => {
    render(
      <UpgradeChooser
        check={{
          ...CHECKED,
          check: {
            state: "checked",
            checkedAt: "x",
            available: false,
            cves: {
              vulnerable: 2,
              fixable: 0,
              severity: "high",
              packages: [],
            },
            latest: { packages: [], val: null },
            majors: { packages: [] },
          },
        }}
        start={{ status: "idle" }}
        onStart={() => {}}
        onRecheck={() => {}}
      />,
    );
    expect(
      screen.getByText(
        "The site's dependencies are up to date. 2 packages are vulnerable, with no fix an upgrade can take yet.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: /create proposal/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  test("Preparing… says where the upgrade is, and nothing can be pressed again meanwhile", () => {
    const onStart = jest.fn();
    render(
      <UpgradeChooser
        check={CHECKED}
        start={{
          status: "preparing",
          line: "Building the dependencies · Installing the packages (1 of 2)",
        }}
        onStart={onStart}
        onRecheck={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: /preparing/i });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText(
        "Building the dependencies · Installing the packages (1 of 2)",
      ),
    ).toBeTruthy();
    fireEvent.click(button);
    expect(onStart).not.toHaveBeenCalled();
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
  render: { state: "done", detail: null, retryable: false, deferred: false },
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
  onRender: () => void;
  onPublish: () => void;
  onRetryPublish: () => void;
  onCheckMerge: () => void;
  onReview: () => void;
  onDiscard: () => void;
  onGoToSite: () => void;
  onCloseTab: () => void;
};

/** The tab's page, with the footer it derives from the view and the publish. */
const progress = (
  v: UpgradeProgressView | null,
  publish: PublishProposalState = READY,
  handlers: Partial<Handlers> = {},
) =>
  render(
    <UpgradeProgressPage
      displayName={v === null ? null : "Upgrade to new major versions"}
      view={v}
      publish={publish}
      footer={upgradeFooterOf(v, publish)}
      onComputeLockfile={handlers.onComputeLockfile ?? (() => {})}
      onTypecheck={handlers.onTypecheck ?? (() => {})}
      onBuild={handlers.onBuild ?? (() => {})}
      onRender={handlers.onRender ?? (() => {})}
      onPublish={handlers.onPublish ?? (() => {})}
      onRetryPublish={handlers.onRetryPublish ?? (() => {})}
      onCheckMerge={handlers.onCheckMerge ?? (() => {})}
      onReview={handlers.onReview ?? (() => {})}
      onDiscard={handlers.onDiscard ?? (() => {})}
      onGoToSite={handlers.onGoToSite ?? (() => {})}
      onCloseTab={handlers.onCloseTab ?? (() => {})}
    />,
  );

/** The footer's right-hand button: the next step, where Publish is. */
const footerButton = () => {
  const buttons = within(
    screen.getByRole("group", { name: "Next step" }),
  ).getAllByRole("button");
  const last = buttons[buttons.length - 1];
  if (last === undefined) throw new Error("no button in the footer");
  return last;
};

describe("an upgrade, in its own tab to Go to site", () => {
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
    expect(screen.getByText("Renders on the platform")).toBeTruthy();
    expect(
      screen.getByText("Built, no new type errors, and it renders."),
    ).toBeTruthy();
    fireEvent.click(footerButton());
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  test("the new build renders on the platform before Publish can be pressed", () => {
    progress(
      view({
        render: {
          state: "running",
          detail: null,
          retryable: false,
          deferred: false,
        },
        canPublish: false,
      }),
    );
    expect(
      screen.getByText("Rendering the new build on the platform…"),
    ).toBeTruthy();
    expect(
      screen.getByText("Publish waits for the new build to render."),
    ).toBeTruthy();
    expect(footerButton().hasAttribute("disabled")).toBe(true);
  });

  test("a build that does not render says why, and is not offered for Publish", () => {
    progress(
      view({
        render: {
          state: "failed",
          detail: "/ answered 500: Cannot find module 'react/jsx-runtime'",
          retryable: false,
          deferred: false,
        },
        canPublish: false,
      }),
    );
    expect(screen.getByText("The new build does not render")).toBeTruthy();
    expect(
      screen.getByText(
        "/ answered 500: Cannot find module 'react/jsx-runtime'",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/does not render, so it cannot be published/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /publish/i })).toBeNull();
  });

  test("a render the platform could not do: Try again renders it again", () => {
    const onRender = jest.fn();
    progress(
      view({
        render: {
          state: "failed",
          detail: "The loader did not answer.",
          retryable: true,
          deferred: false,
        },
        canPublish: false,
      }),
      READY,
      { onRender },
    );
    fireEvent.click(footerButton());
    expect(onRender).toHaveBeenCalledTimes(1);
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
    const onCheckMerge = jest.fn();
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
      { onCheckMerge },
    );
    fireEvent.click(screen.getByRole("button", { name: /check the merge/i }));
    expect(onCheckMerge).toHaveBeenCalledTimes(1);
  });

  test("ready: Review opens the proposal beside Publish, which publishes directly", () => {
    const onReview = jest.fn();
    const onPublish = jest.fn();
    progress(view(), READY, { onReview, onPublish });
    fireEvent.click(screen.getByRole("button", { name: /review/i }));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(footerButton().textContent).toMatch(/Publish/);
    fireEvent.click(footerButton());
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  test("an open upgrade can be discarded, and a published one only left", () => {
    const onDiscard = jest.fn();
    const { unmount } = progress(view(), READY, { onDiscard });
    fireEvent.click(screen.getByRole("button", { name: /discard upgrade/i }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    unmount();

    const onCloseTab = jest.fn();
    progress(view(), { kind: "merged" }, { onCloseTab });
    expect(screen.queryByRole("button", { name: /discard/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /review/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /close tab/i }));
    expect(onCloseTab).toHaveBeenCalledTimes(1);
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
    expect(footerButton().textContent).toMatch(/Discard upgrade/);
  });
});
