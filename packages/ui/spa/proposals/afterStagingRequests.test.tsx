/**
 * @jest-environment jsdom
 */
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { CodeChangesConnected } from "../components/proposals/CodeChangesConnected";
import { useCodeModeQuickPreview } from "../components/proposals/useCodeModeQuickPreview";
import { createProposalsClient } from "./proposalsClient";
import { resetServerBuildsForTests } from "./serverFirst";
import { proposalCodeChanged } from "./useProposalBuild";
import { useProposals } from "./useProposals";
import {
  installCountingFetch,
  NAME,
  type CountingFetch,
} from "./__fixtures__/countingFetch";

/*
 * How many requests FOLLOW one staging, after the tool has answered: what
 * the Studio reads again when the code tools say the proposal's code moved
 * (`proposalCodeChanged`), up to the quick preview being handed to the page.
 * The other half of `codeToolRequests.test.ts`, with the same rules: counts,
 * never milliseconds, one named list per reader.
 *
 * Each reader below is the product's own, mounted as the Studio mounts it,
 * with the network counted. They are mounted one at a time so that each
 * count has one owner; in the Studio they all hear the same change at once.
 *
 * NOT counted here, because jest cannot mount them: the canvas loading the
 * page again with the quick preview's files (`CanvasFrame`), which is the
 * page's own requests, not Val's API.
 */
const mockProposal = { name: NAME, branch: `val/p/${NAME}` };
jest.mock("../components/ValProvider", () => ({
  useCurrentProposal: () => mockProposal,
  useStudioDeployState: () => ({ deploy: jest.fn(), state: null }),
}));
jest.mock("../stores/react/SystemContext", () => ({
  useValSystem: () => ({
    system: {
      manifest: {
        seq: () => 1,
        onSeq: () => () => {},
        servedBuild: () => null,
        onServedBuild: () => () => {},
      },
    },
  }),
}));
// The pane's rendering: what it reads is `CodeChangesConnected`'s.
jest.mock("../components/proposals/CodeChanges", () => ({
  CodeChanges: () => null,
}));

jest.setTimeout(15_000);

let counted: CountingFetch;
beforeEach(async () => {
  resetServerBuildsForTests();
  counted = installCountingFetch();
  // One staging, so that there is something staged to preview.
  await createProposalsClient({ api: "/api/val" }).stageFiles(NAME, {
    "src/app.tsx": "export const App = () => 1;\n",
  });
  counted.take();
});
afterEach(() => counted.restore());

/** Wait until `count` requests were made, then for any more to show up. */
async function settled(count: number): Promise<string[]> {
  await waitFor(
    () => expect(counted.requests.length).toBeGreaterThanOrEqual(count),
    {
      timeout: 5000,
    },
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
  return counted.take();
}

// ---------------------------------------------------------------------------
// The counts: what each reader asks when the code moved once.
// ---------------------------------------------------------------------------

/** The proposals bar reads the list and the proposal again (`useProposals`' `refresh`). */
const PROPOSALS_BAR = ["GET /proposals-api", "GET /proposals-api/:name"];
/** The Code changes pane, while it is open: the proposal's files and the site's source, whole. */
const CODE_CHANGES_PANE = [
  "GET /proposals-api/:name/files",
  "GET /publish-api/project-source",
];
/**
 * The quick preview by itself: what is staged (to decide whether to run),
 * then a second later what is staged again (to name what to build) and the
 * build itself on Val Build.
 */
const QUICK_PREVIEW = [
  "GET /proposals-api/:name",
  "GET /proposals-api/:name",
  "POST /proposals-api/:name/quick-preview",
];

describe("requests that follow one staging", () => {
  test("the proposals bar", async () => {
    const hook = renderHook(() =>
      useProposals({ enabled: true, current: NAME }),
    );
    await settled(PROPOSALS_BAR.length);
    // `useProposalsBar` calls this once per change: its effect on the build
    // store's `changed` is three lines around this call.
    await act(() => hook.result.current.refresh());
    expect(counted.take()).toEqual(PROPOSALS_BAR);
  });

  test("the Code changes pane, when it is open", async () => {
    render(
      <CodeChangesConnected
        name={NAME}
        build={{ state: "behind" }}
        onReload={() => {}}
        onEditContent={() => {}}
      />,
    );
    await settled(CODE_CHANGES_PANE.length);
    act(() => proposalCodeChanged());
    expect(await settled(CODE_CHANGES_PANE.length)).toEqual(CODE_CHANGES_PANE);
  });

  test("the quick preview by itself, until its files are handed to the page", async () => {
    const store = jest.fn(async () => {});
    const hook = renderHook(() =>
      useCodeModeQuickPreview({ pageLive: true, buildEpoch: 0 }),
    );
    act(() => hook.result.current.setStorer(store));
    // Mounting previews what is staged already: let that one finish.
    await waitFor(() => expect(store).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    await waitFor(() => expect(hook.result.current.quickId).not.toBeNull());
    act(() =>
      hook.result.current.onDocument({ quick: hook.result.current.quickId }),
    );
    await waitFor(() => expect(hook.result.current.state.status).toBe("idle"));
    counted.take();

    // The assistant stages again, and says so.
    await createProposalsClient({ api: "/api/val" }).stageFiles(NAME, {
      "src/app.tsx": "export const App = () => 2;\n",
    });
    counted.take();
    act(() => proposalCodeChanged());
    await waitFor(() => expect(store).toHaveBeenCalledTimes(2), {
      timeout: 5000,
    });
    expect(counted.take()).toEqual(QUICK_PREVIEW);
  });

  test("all of it, for one edit_file in a Studio with the Code changes pane closed", () => {
    // What the person waits through between sending a prompt that makes one
    // edit and seeing it: the tool's own 7 (`codeToolRequests.test.ts`),
    // then these.
    expect([...PROPOSALS_BAR, ...QUICK_PREVIEW]).toHaveLength(5);
  });
});
