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
import { serverBuildsKnownOff, serverFirst } from "../../proposals/serverFirst";
import { randomUUID } from "../../utils/randomUUID";
import type {
  QuickPreviewResult,
  QuickPreviewTiming,
} from "../../proposals/proposalCode";

/**
 * The design tab's quick preview (`quickPreview.ts` in `@valbuild/shared`):
 * the proposal's client code bundled, handed to the page in the preview, and
 * shown there in seconds -- with the server's half still the last build's,
 * which the tab says.
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
  const running = useRef<Promise<QuickPreviewResult> | null>(null);
  /** The staged inputs the last quick preview shown was of. */
  const shownInputs = useRef<string | null>(null);

  /**
   * `auto`: one the tab starts itself after a change (`DesignTab`), and only
   * where Val Build makes it -- never a bundle here or a builder tab nobody
   * asked for. It says nothing when there is nothing to do: Val Build off,
   * no page yet, or what is staged shown already.
   */
  const run = useCallback(
    (options?: { auto?: boolean }): Promise<QuickPreviewResult> => {
      if (running.current !== null) return running.current;
      const auto = options?.auto === true;
      if (auto && (serverBuildsKnownOff() || storer.current === null)) {
        return Promise.resolve({ status: "skipped", timings: [] });
      }
      const startedAt = Date.now();
      const timings: QuickPreviewTiming[] = [];
      let stepNow = { label: "Reading the proposal", at: startedAt };
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
          ? await quickPreviewOnServer(name, proposals, onStep)
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
            );
        if (built.status === "off") {
          return { status: "skipped", timings: end() };
        }
        if (built.status === "failed") {
          return { status: "failed", message: built.message, timings: end() };
        }
        // A builder tab's quick preview says nothing of what it was made of
        const builtInputs =
          "inputs" in built && typeof built.inputs === "string"
            ? built.inputs
            : null;
        if (
          auto &&
          builtInputs !== null &&
          builtInputs === shownInputs.current
        ) {
          return { status: "skipped", timings: end() };
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
          if (result.status !== "skipped") setLast(result);
          setState(
            result.status === "failed"
              ? { status: "failed", message: result.message }
              : { status: "idle" },
          );
          return result;
        });
      running.current = work;
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
      blocked: inTab?.blocked === true,
    }),
    [state, last, shownId, run, setStorer, onFront, dismiss, inTab],
  );
}
