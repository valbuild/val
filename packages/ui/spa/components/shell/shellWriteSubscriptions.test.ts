import fs from "fs";
import path from "path";

/**
 * Nothing that builds the shell's props may be rendered by a field write.
 *
 * ## What it costs
 *
 * `ValShellBody` builds the props of the whole Studio and `useShellData` its
 * data, so a render of either is a render of the rail, the bars, every panel,
 * the editor and the canvas: about 1,500 components on a small page. Each of
 * the hooks below renders its caller for every field write -- some twice,
 * once when the patch is made and once when it is saved -- and between them
 * they made one write nine renders of all of it
 * (`docs/plans/studio-write-lag.md`).
 *
 * What a write moves is read in `ValShellLive` and `useShellLiveData`, which
 * are below the shell's frame, and shown from `ShellLive`'s store.
 *
 * ## Why it is static
 *
 * For the reason `perFieldSubscriptions.test.ts` is: rendering the real
 * `ValShell` takes the whole provider tree and a system. What that would
 * count is counted by `e2e/measure/studioWriteRenders.measure.ts`, against a
 * running Studio; `shellLive.test.tsx` renders `Shell` itself. This is the
 * cheap net for the half of it that a hook two calls deep can undo.
 *
 * ## When this fails
 *
 * Read what the hook answers where it is SHOWN: in `ValShellLive`, or in the
 * component that shows it. Where the shell needs the answer only some of the
 * time -- in a proposal, under a refusal -- use the form of the hook that
 * takes `watch` and subscribes only then (`useChangesToReview(inProposal)`).
 */
const SHELL = path.join(__dirname, "ValShell.tsx");
const SHELL_DATA = path.join(__dirname, "useShellData.ts");

/** Hooks that render their caller for every field write. */
const PER_WRITE_HOOKS = [
  // The chain: every patch created, saved, dropped or fetched.
  "useChainVersion",
  "usePatchSets",
  "useCurrentPatchIds",
  "usePendingChangeCount",
  "usePendingClientSidePatchIds",
  "usePendingServerSidePatchIds",
  "usePendingPatchesForModule",
  "useDiscardAll",
  // The write queue: pending, saving, in sync, for each write.
  "usePatchSyncState",
  "useLoadingStatus",
  "useSteadySaveState",
  // Every module's source: any write anywhere.
  "useAllSources",
  "useNoOpSourcePaths",
];

/**
 * Calls that are per write only when made without their `watch` argument:
 * with one, they subscribe only while it is true.
 */
const UNGATED_CALLS = [
  "useChangesToReview()",
  "useProjectSeq()",
  "useSettledProjectSeq()",
];

/** The file with its comments removed. See `perFieldSubscriptions.test.ts`. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** The code from `start` up to `end`, both of which must be there. */
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from === -1 || to === -1) {
    throw new Error(
      `Could not find the code between "${start}" and "${end}": if it was ` +
        "renamed or moved, say where it is now, so this still guards it",
    );
  }
  return source.slice(from, to);
}

const sections: [string, string][] = [
  [
    "ValShellBody",
    between(
      code(SHELL),
      "const ValShellBody = memo(function ValShellBody(",
      "function ValShellLive(",
    ),
  ],
  [
    "useShellData",
    between(
      code(SHELL_DATA),
      "export function useShellData(",
      "export function useShellLiveData(",
    ),
  ],
];

describe("what builds the shell's props is not rendered by a field write", () => {
  for (const [name, source] of sections) {
    for (const hook of PER_WRITE_HOOKS) {
      test(`${name} does not call ${hook}()`, () => {
        expect(source.includes(`${hook}(`)).toBe(false);
      });
    }
    for (const call of UNGATED_CALLS) {
      test(`${name} does not call ${call} without saying when to watch`, () => {
        expect(source.includes(call)).toBe(false);
      });
    }
  }

  // The guard on the guard: the hooks did not simply stop existing.
  test("what a write moves is read below the frame, in ValShellLive", () => {
    const live = between(code(SHELL), "function ValShellLive(", "<Shell");
    for (const hook of [
      "usePatchSyncState",
      "usePendingClientSidePatchIds",
      "useSteadySaveState",
      "useDiscardAll",
      "useShellLiveData",
    ]) {
      expect(live.includes(`${hook}(`)).toBe(true);
    }
  });
});
