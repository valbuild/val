import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowUpCircle, ExternalLink, X } from "lucide-react";
import { useStudioIsDeployer } from "../components/ValProvider";
import type { ProposalCodeState } from "../components/proposals/types";
import {
  ProposalsApiError,
  type ProposalBuildVerify,
  type ProposalJson,
  type ProposalsClient,
} from "../proposals/proposalsClient";
import type { ProposalTypecheckState } from "../proposals/useProposalTypecheck";
import type { ProposalBuildProgress } from "../proposals/proposalBuildProgress";
import type { PublishProposalState } from "../components/proposals/PublishProposalDialog";
import { randomUUID } from "../utils/randomUUID";
import type { UpgradeStart } from "./UpgradeChooser";
import { UpgradeDialog } from "./UpgradeDialog";
import { UpgradeProgressPage, UpgradeTabMessage } from "./UpgradeProgressPage";
import {
  renderKeyOf,
  upgradeFooterOf,
  upgradeProgressOf,
  type UpgradeRenderState,
} from "./upgradeProgress";
import { useUpgradeCheck, type UpgradeCheckState } from "./useUpgradeCheck";
import type { UpgradePath } from "./upgradesClient";
import { openUpgradeTab, upgradeTabUrl } from "./upgradeTab";
import { prepareUpgrade } from "./prepareUpgrade";

/*
 * The Upgrade (valbuild/home `docs/adept.md`, step 7, "How one Upgrade goes"):
 * the button, shown while the check says there is something; its dialog,
 * whose Create proposal prepares the upgrade in place -- worked out and its
 * dependencies built, Preparing… saying where it is (`prepareUpgrade.ts`) --
 * and then goes to its page (`upgradeTab.ts`), which follows it the rest of
 * the way: typechecked, built, rendered, published, Go to site. The proposals
 * bar builds and publishes it, as any proposal; this is what a person sees of
 * that.
 *
 * Outside its page an upgrade proposal is a way back to it: the Studio on the
 * site says one is running, and the Studio at its address -- where Review
 * goes -- offers Open upgrade.
 */

/** How often the Studio on the site reads the list while an upgrade runs. */
const FOLLOW_MS = 10_000;

/** What the Studio's chrome needs for the Upgrade button. */
export type UpgradeButton = {
  /** A vulnerability the upgrade fixes: the button is marked. */
  vulnerable: boolean;
  onOpen: () => void;
};

/** What Settings → Updates needs: the chooser, without the dialog. */
export type UpgradeSettings = {
  check: UpgradeCheckState;
  start: UpgradeStart;
  onStart: (path: UpgradePath, skip: string[]) => void;
  onRecheck: () => void;
};

export function useUpgrade(input: {
  /** Proposals are on in this project: an upgrade is one. */
  enabled: boolean;
  /** This document is the upgrade tab (`upgradeTab.ts`). */
  inTab: boolean;
  here: { name: string } | null;
  /** Every proposal, as the list has it: the site follows an upgrade by it. */
  proposals: ProposalJson[];
  current: ProposalJson | null;
  code: ProposalCodeState | null;
  typecheck: ProposalTypecheckState;
  onTypecheck: (() => void) | null;
  onComputeLockfile: () => void;
  onBuild: () => void;
  /** What Create proposal makes the proposal with, and follows it by. */
  client: Pick<ProposalsClient, "create" | "get" | "close" | "preparation">;
  /**
   * Render the proposal's own build on the platform, as a publish does
   * before it goes live; `null` where this Studio cannot.
   */
  verifyBuild: ((name: string) => Promise<ProposalBuildVerify>) | null;
  /** How far a running build of the proposal is. */
  buildProgress: ProposalBuildProgress | null;
  /** The proposal's publish, as the bar runs it. */
  publish: {
    state: PublishProposalState;
    /** Read whether it can be published: the checks. */
    onPrepare: () => void;
    onPublish: () => void;
    onRetry: () => void;
    /** The proposal's own Publish dialog, for a check only it clears. */
    onCheckMerge: () => void;
    /** `undefined` when the project has not said where its site is. */
    onGoToSite?: () => void;
  };
  /** Close the proposal, after asking. */
  onDiscard: () => void;
  /** The proposal in the Studio, at the same address. */
  onReview: () => void;
  onRefresh: () => void;
  portalContainer?: HTMLElement | null;
}): {
  /** `null` while there is nothing to upgrade, or nobody here can. */
  button: UpgradeButton | null;
  /** `null` where this Studio does not upgrade. */
  settings: UpgradeSettings | null;
  dialogs: ReactNode;
  /**
   * Above the editor: on the site, an upgrade running in its tab; at an
   * upgrade proposal's address, where it is and the way back to its tab.
   */
  notice: ReactNode | null;
  /** In the upgrade tab, the whole page; `null` anywhere else. */
  page: ReactNode | null;
} {
  const { enabled, inTab, here, current, proposals, onRefresh } = input;
  const deploys = useStudioIsDeployer();
  const usable = enabled && deploys;
  const { state: check, recheck } = useUpgradeCheck({ enabled: usable });

  const [choosing, setChoosing] = useState(false);
  const [start, setStart] = useState<UpgradeStart>({ status: "idle" });
  // One per opening of the dialog: pressing twice is the same upgrade.
  const requestId = useRef(randomUUID());
  const open = useCallback(() => {
    requestId.current = randomUUID();
    setStart({ status: "idle" });
    setChoosing(true);
  }, []);
  /*
   * Create proposal: prepared here, Preparing… saying where it is, and then
   * this tab goes to the upgrade's page. Pressed again after a failure, it is
   * a new proposal: the failed one was closed.
   */
  const { client } = input;
  const preparing = start.status === "preparing";
  const onStart = useCallback(
    (path: UpgradePath, skip: string[]) => {
      if (preparing) return;
      const pressed = requestId.current;
      setStart({ status: "preparing", line: "Creating the proposal…" });
      void prepareUpgrade({
        client,
        path,
        skip,
        requestId: pressed,
        onLine: (line) => setStart({ status: "preparing", line }),
      }).then((prepared) => {
        if (prepared.status === "ready") {
          // Pushed, not replaced: Back from the upgrade is the Studio again.
          window.location.assign(prepared.url);
          return;
        }
        requestId.current = randomUUID();
        setStart(
          prepared.status === "nothing"
            ? { status: "nothing" }
            : { status: "failed", message: prepared.message },
        );
        onRefresh();
      });
    },
    [client, onRefresh, preparing],
  );

  // At an upgrade proposal's address: the upgrade it is.
  const upgrade =
    here !== null && current !== null && current.name === here.name
      ? (current.upgrade ?? null)
      : null;
  // Content computes the upgrade on its own: read it again until it has.
  const computing = inTab && upgrade?.state === "computing";
  useEffect(() => {
    if (!computing) return;
    const timer = setInterval(onRefresh, 3_000);
    return () => clearInterval(timer);
  }, [computing, onRefresh]);

  const [render, setRender] = useState<UpgradeRenderState>({ status: "idle" });
  const view = useMemo(
    () =>
      upgrade !== null && current !== null
        ? upgradeProgressOf({
            proposal: current,
            upgrade,
            typecheck: input.typecheck,
            code: input.code,
            buildProgress: input.buildProgress,
            render,
          })
        : null,
    [
      upgrade,
      current,
      input.typecheck,
      input.code,
      input.buildProgress,
      render,
    ],
  );
  /*
   * Typechecked with no new errors and built: the build is rendered on the
   * platform, by itself, before Publish is offered. A render this tab has
   * asked for is not asked for again until Try again.
   */
  const { verifyBuild } = input;
  const renderKey = current !== null ? renderKeyOf(current) : null;
  const renderName = current?.name ?? null;
  const toRender =
    inTab &&
    view?.render.state === "running" &&
    !("key" in render && render.key === renderKey)
      ? renderKey
      : null;
  useEffect(() => {
    if (toRender === null || renderName === null) return;
    const key = toRender;
    if (verifyBuild === null) {
      setRender({ status: "unsupported", key });
      return;
    }
    setRender({ status: "running", key });
    verifyBuild(renderName).then(
      (verified) =>
        setRender(
          verified.ok
            ? { status: "passed", key }
            : {
                status: "failed",
                key,
                message:
                  verified.problems.map((p) => p.message).join(" ") ||
                  "The new build did not render.",
                retryable: verified.transient,
              },
        ),
      (error: unknown) =>
        setRender(
          // A content service from before it could render one: the publish
          // renders it, as it always did.
          error instanceof ProposalsApiError && error.status === 404
            ? { status: "unsupported", key }
            : {
                status: "failed",
                key,
                message: error instanceof Error ? error.message : String(error),
                retryable: true,
              },
        ),
    );
  }, [toRender, renderName, verifyBuild]);
  const onRender = useCallback(() => setRender({ status: "idle" }), []);
  // Ready to publish: read the checks, so one press of Publish publishes.
  // Again whenever what is staged moves, since that is what they check.
  const { publish } = input;
  const onPrepare = publish.onPrepare;
  const prepared = useRef<string | null>(null);
  const readyFor =
    inTab && view?.canPublish ? (current?.staged?.inputs ?? "") : null;
  useEffect(() => {
    if (readyFor === null || prepared.current === readyFor) return;
    prepared.current = readyFor;
    onPrepare();
  }, [readyFor, onPrepare]);
  const footer = upgradeFooterOf(view, publish.state);

  const vulnerable =
    check.status === "checked" &&
    check.check.state === "checked" &&
    check.check.cves.vulnerable > 0;
  const available =
    check.status === "checked" &&
    check.check.state === "checked" &&
    check.check.available;
  const button: UpgradeButton | null =
    usable && available && upgrade === null
      ? { vulnerable, onOpen: open }
      : null;
  const settings: UpgradeSettings | null = usable
    ? {
        check,
        start,
        onStart,
        onRecheck: recheck,
      }
    : null;

  const { onTypecheck, onComputeLockfile, onBuild, portalContainer } = input;
  const dialogs = usable ? (
    <UpgradeDialog
      open={choosing}
      onOpenChange={setChoosing}
      check={check}
      start={start}
      onStart={onStart}
      onRecheck={recheck}
      portalContainer={portalContainer}
    />
  ) : null;

  const notAnUpgrade =
    here !== null &&
    current !== null &&
    current.name === here.name &&
    current.upgrade === undefined;
  const page = !inTab ? null : notAnUpgrade ? (
    <UpgradeTabMessage message="This proposal is not an upgrade. Its changes are made and published in the Studio." />
  ) : (
    <UpgradeProgressPage
      displayName={view !== null ? (current?.displayName ?? null) : null}
      view={view}
      publish={publish.state}
      footer={footer}
      onComputeLockfile={onComputeLockfile}
      onTypecheck={() => onTypecheck?.()}
      onBuild={onBuild}
      onRender={onRender}
      onPublish={publish.onPublish}
      onRetryPublish={publish.onRetry}
      onCheckMerge={publish.onCheckMerge}
      onReview={input.onReview}
      onDiscard={input.onDiscard}
      {...(publish.onGoToSite !== undefined
        ? { onGoToSite: publish.onGoToSite }
        : {})}
      onCloseTab={() => window.close()}
    />
  );

  /*
   * On the site: an upgrade under way, until it is published or discarded,
   * with the way to its page. The list is read again while there is one,
   * since nothing else tells this page how it is doing.
   */
  const running =
    here === null
      ? (proposals.find(
          (p) =>
            p.upgrade !== undefined &&
            p.status !== "merged" &&
            p.status !== "closed",
        ) ?? null)
      : null;
  // While this page prepares one, it says so itself, beside its button.
  const following = running !== null && !preparing;
  useEffect(() => {
    if (!following) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") onRefresh();
    }, FOLLOW_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") onRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [following, onRefresh]);
  const runningAddress = running?.address ?? null;
  const siteNotice =
    running === null || preparing ? null : (
      <UpgradeNotice
        text={`${running.displayName}: an upgrade is under way.`}
        {...(runningAddress !== null
          ? {
              action: {
                label: "Open upgrade",
                onClick: () =>
                  openUpgradeTab(
                    upgradeTabUrl(runningAddress, running.name),
                    `val-upgrade-${running.name}`,
                  ),
              },
            }
          : {})}
      />
    );

  /*
   * At an upgrade proposal's address, outside its tab -- where Review goes:
   * how the upgrade stands, and Open upgrade, back to the tab here.
   */
  const hereName = here?.name ?? null;
  const proposalNotice =
    !inTab &&
    hereName !== null &&
    view !== null &&
    current !== null &&
    current.status === "open" ? (
      <UpgradeNotice
        text={
          view.upgrade.state === "computing"
            ? "Computing the upgrade…"
            : view.upgrade.state === "nothing"
              ? "There was nothing to upgrade."
              : view.upgrade.state === "failed"
                ? "The upgrade could not be computed."
                : view.canPublish
                  ? "The upgrade is ready to publish."
                  : view.typecheck.state === "done" &&
                      (view.typecheck.newErrors ?? 0) > 0
                    ? `The upgrade adds ${view.typecheck.newErrors} type ${view.typecheck.newErrors === 1 ? "error" : "errors"}.`
                    : "The upgrade runs in its own tab."
        }
        action={{
          label: "Open upgrade",
          onClick: () =>
            window.location.assign(
              upgradeTabUrl(window.location.origin, hereName),
            ),
        }}
      />
    ) : null;
  const notice = siteNotice ?? proposalNotice;
  return { button, settings, dialogs, notice, page };
}

function UpgradeNotice({
  text,
  action,
  onDismiss,
}: {
  text: string;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-lg border border-border-proposal bg-bg-proposal-soft px-4 py-3 text-xs text-fg-primary"
    >
      <span className="flex items-center gap-2">
        <ArrowUpCircle size={14} className="shrink-0 text-fg-proposal" />
        {text}
      </span>
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-proposal px-2 font-medium hover:bg-bg-proposal-soft"
        >
          {action.label} <ExternalLink size={12} />
        </button>
      )}
      {onDismiss !== undefined && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-bg-proposal-soft"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
