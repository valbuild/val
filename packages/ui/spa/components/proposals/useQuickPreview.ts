import { useCallback, useMemo, useRef, useState } from "react";
import {
  buildQuickPreview,
  createStudioPublishClient,
} from "@valbuild/shared/publish";
import type { QuickPreviewStorer } from "../shell/canvas/CanvasFrame";
import type { ProposalsClient } from "../../proposals/proposalsClient";
import {
  holdingBuilder,
  loadBuilder,
  routeTreeGenerator,
} from "../../publish/loadBuilder";
import { canBuildHere } from "../../publish/handoff";
import { quickPreviewInTab } from "../../proposals/buildInTab";
import { quickPreviewOnServer } from "../../proposals/quickPreviewOnServer";
import { setStagedPreview } from "../../proposals/quickPreviewControl";
import {
  markServerOff,
  serverFirst,
  serverKnownOff,
} from "../../proposals/serverFirst";
import { randomUUID } from "../../utils/randomUUID";
import type {
  QuickPreviewResult,
  QuickPreviewTiming,
} from "../../proposals/proposalCode";

/**
 * A proposal's quick preview (`quickPreview.ts` in `@valbuild/shared`): its
 * client code bundled, handed to the page in the preview, and shown there in
 * seconds -- with the server's half still the last build's, which the Studio
 * says. Kept for code mode's preview, which is to take it next; the design
 * tab that used it is gone.
 *
 * Bundled by Val Build where it builds the project (`quickPreviewOnServer`),
 * so the page needs no cross-origin isolation and no builder tab; here, or in
 * a builder tab, where it does not yet.
 */

export type QuickPreviewState =
  | { status: "idle" }
  | { status: "running"; step: string; startedAt: number }
  | { status: "failed"; message: string };

/** How long the page opened as the preview is given to come to the front. */
const SHOW_TIMEOUT_MS = 30_000;

export function useQuickPreview(
  name: string,
  proposals: Pick<
    ProposalsClient,
    "files" | "buildTarget" | "get" | "quickPreview"
  >,
) {
  const [state, setState] = useState<QuickPreviewState>({ status: "idle" });
  const [shownId, setShownId] = useState<string | null>(null);
  const [last, setLast] = useState<QuickPreviewResult | null>(null);
  /** Bundled in a builder tab: `blocked` while the browser has not let it open. */
  const [inTab, setInTab] = useState<{
    blocked: boolean;
    step: string | null;
  } | null>(null);
  const storer = useRef<QuickPreviewStorer | null>(null);
  const setStorer = useCallback((store: QuickPreviewStorer | null) => {
    storer.current = store;
  }, []);
  /** Waiting for a quick preview to come to the front, by id. */
  const showing = useRef(new Map<string, () => void>());
  const onFront = useCallback((front: { quick: string | null }) => {
    if (front.quick === null) return;
    showing.current.get(front.quick)?.();
    showing.current.delete(front.quick);
  }, []);
  const running = useRef<{
    work: Promise<QuickPreviewResult>;
    auto: boolean;
  } | null>(null);
  /**
   * A change came while one ran: another automatic one after it, of the
   * newest inputs asked for (`null`: whatever is staged then).
   */
  const autoAgain = useRef<{ inputs: string | null } | null>(null);
  /** The staged inputs the last quick preview shown was of. */
  const shownInputs = useRef<string | null>(null);
  /** Whether the quick preview shown is of the staged files `inputs` name. */
  const isShown = useCallback(
    (inputs: string) => shownInputs.current === inputs,
    [],
  );
  /** The canvas went back to a served build: no quick preview is shown. */
  const forgetShown = useCallback(() => {
    shownInputs.current = null;
  }, []);

  /**
   * `auto`: one started by itself after a change, and only
   * where Val Build makes it -- never a bundle here or a builder tab nobody
   * asked for. It says nothing when there is nothing to do (Val Build off,
   * what is staged shown already) and nothing when it fails: the person did
   * not ask, and a change half-way through an edit is often one that does
   * not build. A change while one runs is shown after it, never dropped.
   * `inputs`: what is staged, when the caller knows -- the staging answered
   * it -- so nothing is read, and nothing is built, to learn that the
   * preview already shows it.
   *
   * One asked for -- the button, the assistant's `quick_preview` -- never
   * joins an automatic one, whose files may be older than the ask: it waits
   * for it, then makes its own.
   */
  const run = useCallback(
    (options?: {
      auto?: boolean;
      inputs?: string;
    }): Promise<QuickPreviewResult> => {
      const auto = options?.auto === true;
      const known = auto ? options?.inputs : undefined;
      const now = running.current;
      if (now !== null) {
        if (auto) {
          autoAgain.current = { inputs: known ?? null };
          return now.work;
        }
        if (!now.auto) return now.work;
        return now.work.then(() => run());
      }
      if (auto && serverKnownOff("quick-preview")) {
        if (known !== undefined) {
          setStagedPreview({ inputs: known, status: "off" });
        }
        return Promise.resolve({
          status: "skipped",
          reason: "off",
          timings: [],
        });
      }
      // Shown already: nothing to build to find that out.
      if (known !== undefined && known === shownInputs.current) {
        setStagedPreview({ inputs: known, status: "shown" });
        return Promise.resolve({
          status: "skipped",
          reason: "shown",
          timings: [],
        });
      }
      const startedAt = Date.now();
      const timings: QuickPreviewTiming[] = [];
      let stepNow = {
        label:
          known !== undefined
            ? "Building on Val Build"
            : "Reading the proposal",
        at: startedAt,
      };
      /** The staged inputs this one is of, once known. */
      let ofInputs: string | null = known ?? null;
      const step = (label: string) => {
        const at = Date.now();
        timings.push({ step: stepNow.label, ms: at - stepNow.at });
        stepNow = { label, at };
        setState({ status: "running", step: label, startedAt });
      };
      const end = (): QuickPreviewTiming[] => {
        timings.push({ step: stepNow.label, ms: Date.now() - stepNow.at });
        return timings;
      };
      setState({ status: "running", step: stepNow.label, startedAt });
      const work = (async (): Promise<QuickPreviewResult> => {
        const publish = createStudioPublishClient({ api: "/api/val" });
        const generateRouteTree = routeTreeGenerator();
        let first = true;
        const onStep = (label: string) => {
          // The first step is the one already running.
          if (first) {
            first = false;
            if (label === stepNow.label) return;
          }
          if (label !== stepNow.label) step(label);
        };
        const built = auto
          ? await quickPreviewOnServer(name, proposals, onStep, known)
          : await serverFirst(
              () => quickPreviewOnServer(name, proposals, onStep),
              // Safari, an iPhone: bundled in a builder tab, as a build is there.
              () =>
                canBuildHere()
                  ? holdingBuilder(() =>
                      buildQuickPreview({
                        name,
                        proposals,
                        siteSource: () => publish.projectSource(),
                        siteTarget: () => publish.buildTarget(),
                        loadBuilder,
                        ...(generateRouteTree !== null
                          ? { generateRouteTree }
                          : {}),
                        onStep,
                      }),
                    )
                  : quickPreviewInTab(name, {
                      onTab: (inTab) => {
                        setInTab(inTab);
                        if (inTab?.step) onStep(inTab.step);
                        else if (inTab?.blocked)
                          onStep("Waiting for the builder tab");
                      },
                    }),
              "quick-preview",
            );
        if (built.status === "off") {
          markServerOff("quick-preview");
          return { status: "skipped", reason: "off", timings: end() };
        }
        if (built.status === "failed") {
          return { status: "failed", message: built.message, timings: end() };
        }
        // A builder tab's quick preview says nothing of what it was made of
        const builtInputs =
          "inputs" in built && typeof built.inputs === "string"
            ? built.inputs
            : null;
        if (builtInputs !== null) ofInputs = builtInputs;
        if (
          auto &&
          builtInputs !== null &&
          builtInputs === shownInputs.current
        ) {
          return { status: "skipped", reason: "shown", timings: end() };
        }
        const store = storer.current;
        if (store === null) {
          return {
            status: "failed",
            message:
              "No page is showing in the preview to show it in. Wait for it to load, and try again.",
            timings: end(),
          };
        }
        step("Handing it to the page");
        const id = randomUUID().replace(/-/g, "").slice(0, 16);
        await store(id, built.files);
        step("Loading the page with it");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            showing.current.delete(id);
            reject(
              new Error(
                "The page with the quick preview did not load. Build the proposal instead.",
              ),
            );
          }, SHOW_TIMEOUT_MS);
          showing.current.set(id, () => {
            clearTimeout(timer);
            resolve();
          });
          setShownId(id);
        });
        shownInputs.current = builtInputs;
        return {
          status: "shown",
          ms: Date.now() - startedAt,
          timings: end(),
        };
      })()
        .catch(
          (error): QuickPreviewResult => ({
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
            timings: end(),
          }),
        )
        .then((result) => {
          running.current = null;
          // Said for whoever staged the files and waits to know they are
          // seen (`waitForStagedPreview`): only once the page has said it is
          // there, or it is known it will not be.
          if (ofInputs !== null) {
            if (result.status === "shown") {
              setStagedPreview({ inputs: ofInputs, status: "shown" });
            } else if (result.status === "failed") {
              setStagedPreview({
                inputs: ofInputs,
                status: "failed",
                message: result.message,
              });
            } else {
              setStagedPreview({
                inputs: ofInputs,
                status: result.reason === "off" ? "off" : "shown",
              });
            }
          }
          // Quiet when automatic: only what was asked for is reported
          const reported = !auto && result.status !== "skipped";
          if (reported) setLast(result);
          setState(
            reported && result.status === "failed"
              ? { status: "failed", message: result.message }
              : { status: "idle" },
          );
          const again = autoAgain.current;
          if (again !== null) {
            autoAgain.current = null;
            void run({
              auto: true,
              ...(again.inputs !== null ? { inputs: again.inputs } : {}),
            });
          }
          return result;
        });
      running.current = { work, auto };
      return work;
    },
    [name, proposals],
  );

  /** Forget a failure: a build has shown what the quick preview could not. */
  const dismiss = useCallback(() => {
    setState((now) => (now.status === "failed" ? { status: "idle" } : now));
  }, []);

  return useMemo(
    () => ({
      state,
      last,
      shownId,
      run,
      setStorer,
      onFront,
      dismiss,
      isShown,
      forgetShown,
      blocked: inTab?.blocked === true,
    }),
    [
      state,
      last,
      shownId,
      run,
      setStorer,
      onFront,
      dismiss,
      isShown,
      forgetShown,
      inTab,
    ],
  );
}
