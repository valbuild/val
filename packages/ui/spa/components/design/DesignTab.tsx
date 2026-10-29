import { useCallback, useEffect, useMemo, useState } from "react";
import { createStudioPublishClient } from "@valbuild/shared/publish";
import type { HistoricalCommit } from "@valbuild/shared/internal";
import { AIChatSurface } from "../AIChatSurface";
import type { PageCamera, PageReader } from "../shell/canvas/CanvasFrame";
import { DesignPreviewFrames } from "./DesignPreviewFrames";
import { useQuickPreview } from "./useQuickPreview";
import type { CanvasPreviewStatus } from "../shell/canvas/CanvasPreviewNotice";
import { PublishProposalDialog } from "../proposals/PublishProposalDialog";
import { useValPortal } from "../ValPortalProvider";
import { useAllSources, useSchemas } from "../ValFieldProvider";
import { sitePages } from "../../design/sitePages";
import { useDesignPublish } from "./useDesignPublish";
import { useAIChatActions } from "../AIChatActionsContext";
import { useClient, useCurrentProposal } from "../ValProvider";
import { formatRelativeTime } from "../shell/shellDataMapping";
import { canBuildHere } from "../../publish/handoff";
import {
  createProposalsClient,
  type ProposalJson,
} from "../../proposals/proposalsClient";
import {
  openBuilder,
  useProposalBuild,
} from "../../proposals/useProposalBuild";
import { changedFiles, type ChangedFile } from "../../design/changedFiles";
import { lineDiff, type DiffLine } from "../../design/lineDiff";
import { previewUrl, siteDesignTabUrl } from "../../design/designTabUrl";
import {
  modifierLabel,
  type PickedElement,
  type PickModifier,
} from "@valbuild/shared/internal";
import {
  DesignTabView,
  type DesignDevice,
  type DesignCheckItem,
  type DesignCheckpoint,
  type DesignProblem,
} from "./DesignTabView";

/**
 * The design tab, wired (valbuild/home `docs/design-tab.md`, step 4): the
 * proposal `name`'s code, changed by the assistant and previewed at the
 * proposal's own address, from a tab the SITE's build serves.
 *
 * Everything here reaches content through this Studio's own server, which is
 * the site's: the proposal's files and builds (`/proposals-api`, which lets
 * the site write a named proposal's files -- step 2), the site's source to
 * compare them with (`/publish-api`), and the proposal's history. Nothing
 * goes through the proposal's address but the preview, so a build the
 * assistant breaks there takes away the preview and nothing else -- and with
 * step 1 a build that does not render is never served at all.
 */

/** How long the page is given to reflow after the preview's width changes. */
const DEVICE_SETTLE_MS = 600;

/** Held to pick on the page: Option on a Mac, Alt elsewhere. */
const PICK_MODIFIER: PickModifier = "alt";

function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** What is read about the proposal, and what went wrong reading it. */
type Read =
  | { status: "loading" }
  | {
      status: "ready";
      proposal: ProposalJson;
      site: Record<string, string>;
      own: Record<string, string | null>;
      files: ChangedFile[];
    }
  | { status: "error"; message: string };

export function DesignTab({ name }: { name: string }) {
  const proposals = useMemo(
    () => createProposalsClient({ api: "/api/val" }),
    [],
  );
  const studioProposal = useCurrentProposal();
  const { state, build, progress, cancel } = useProposalBuild(proposals, name, {
    onServer: true,
  });
  const { askAssistant } = useAIChatActions();
  const portalContainer = useValPortal();

  const [read, setRead] = useState<Read>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Read again whenever the proposal's code may have changed: a build ended,
  // or the assistant staged files (`proposalCodeChanged`).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // A client per read: one keeps the first answer for the site's
        // source, a failed one included, and Try again has to ask again.
        const publish = createStudioPublishClient({ api: "/api/val" });
        const [proposal, files, site] = await Promise.all([
          proposals.get(name),
          proposals.files(name),
          publish.projectSource(),
        ]);
        if (cancelled) return;
        setRead({
          status: "ready",
          proposal,
          site: site ?? {},
          own: files.files,
          files: changedFiles(site ?? {}, files.files, files.staged.files),
        });
      } catch (error) {
        if (cancelled) return;
        setRead({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name, proposals, state.changed, attempt]);

  const proposal = read.status === "ready" ? read.proposal : null;
  const displayName = proposal?.displayName ?? "this proposal";
  useEffect(() => {
    document.title = `Design · ${displayName}`;
  }, [displayName]);

  const checkpoints = useCheckpoints(proposal?.branch ?? null, state.changed);

  // The frame shows the last build until a new one is served, which is then
  // swapped in behind it (`DesignPreviewFrames`). Reload is the person's.
  const [reloadKey, setReloadKey] = useState(0);
  const builtHash = proposal?.built?.hash ?? null;
  const [swapping, setSwapping] = useState(false);
  const quick = useQuickPreview(name, proposals);
  /** The page in front is a quick preview rather than a served build. */
  const [quickShown, setQuickShown] = useState(false);
  // A build served shows everything a failed quick preview could not.
  const dismissQuick = quick.dismiss;
  useEffect(() => {
    dismissQuick();
  }, [builtHash, dismissQuick]);
  const quickOnFront = quick.onFront;
  const onFront = useCallback(
    (front: { quick: string | null }) => {
      setQuickShown(front.quick !== null);
      quickOnFront(front);
    },
    [quickOnFront],
  );

  const [route, setRoute] = useState("/");
  const address = proposal?.address ?? null;
  // A route that is not a page of the proposal's address shows nothing.
  const previewSrc = address !== null ? previewUrl(address, route) : null;

  const checks = designChecks(proposal, state, progress);
  const problem = designProblem({
    quickError: quick.state.status === "failed" ? quick.state.message : null,
    studioProposal,
    read,
    proposal,
    buildError: state.building ? null : state.error,
    onRetryRead: () => {
      setRead({ status: "loading" });
      setAttempt((n) => n + 1);
    },
    onBuild: build,
    onAskAssistant: (error) =>
      askAssistant(
        `The build of this proposal failed:\n\n${error}\n\nFind the cause in the files, fix it, and build again.`,
      ),
  });

  // Once per file and read: a diff is a table of up to millions of cells,
  // and the view renders on every tick of a build.
  const diffOf = useMemo(() => {
    const diffs = new Map<string, DiffLine[]>();
    return (path: string): DiffLine[] => {
      if (read.status !== "ready") return [];
      let diff = diffs.get(path);
      if (diff === undefined) {
        diff = lineDiff(read.site[path] ?? null, read.own[path] ?? null);
        diffs.set(path, diff);
      }
      return diff;
    };
  }, [read]);

  // The site's pages, for the page menu.
  const schemas = useSchemas();
  const sources = useAllSources();
  const pages = useMemo(
    () =>
      schemas.status === "success" ? sitePages(schemas.data, sources) : [],
    [schemas, sources],
  );

  // Picking on the page, any element: what is picked goes to the assistant
  // with the next message (`UseAIOptions.design.pointedAt`).
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<PickedElement | null>(null);
  // Esc stops Select from here too: right after pressing it the focus is in
  // this tab, and the page hears its own keys only once it has been clicked.
  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);
  const [frameStatus, setFrameStatus] =
    useState<CanvasPreviewStatus>("connecting");
  /** Reads the page in front: the assistant's `read_page`. */
  const [pageReader, setPageReaderState] = useState<PageReader | null>(null);
  // A function in state is set with an updater, or React calls it.
  const setPageReader = useCallback(
    (reader: PageReader | null) => setPageReaderState(() => reader),
    [],
  );
  /** Pictures the page in front: the assistant's `screenshot_page`. */
  const [pageCamera, setPageCameraState] = useState<PageCamera | null>(null);
  const setPageCamera = useCallback(
    (camera: PageCamera | null) => setPageCameraState(() => camera),
    [],
  );
  const [device, setDevice] = useState<DesignDevice>("desktop");
  /** `read_page`'s `device`: the width, and a moment for the page to reflow. */
  const showDevice = useCallback(async (next: DesignDevice) => {
    setDevice(next);
    await new Promise((resolve) => setTimeout(resolve, DEVICE_SETTLE_MS));
  }, []);
  const [enableKey, setEnableKey] = useState(0);
  const addressOrigin = useMemo(() => {
    try {
      return address !== null ? new URL(address).origin : null;
    } catch {
      return null;
    }
  }, [address]);

  const publish = useDesignPublish(name, proposal, proposals);

  const open = proposal?.status === "open";
  return (
    <>
      <DesignTabView
        proposal={{ displayName, address }}
        previewHref={previewSrc}
        studioUrl={
          address !== null ? new URL("/val", address).toString() : null
        }
        route={route}
        onRouteChange={setRoute}
        pages={pages}
        picking={
          previewSrc === null
            ? null
            : {
                active: picking,
                onToggle: () => setPicking((on) => !on),
                // The page's bridge picks whether or not it is in preview
                // mode: only a page that never answered cannot.
                status:
                  frameStatus === "live" || frameStatus === "preview-off"
                    ? "live"
                    : frameStatus === "no-answer"
                      ? "off"
                      : "waiting",
                onTurnOn: () => setEnableKey((key) => key + 1),
                modifier: modifierLabel(PICK_MODIFIER, isMac()),
              }
        }
        picked={picked}
        onClearPicked={() => setPicked(null)}
        onPublish={open ? () => publish.setOpen(true) : null}
        onReload={() => setReloadKey((key) => key + 1)}
        device={device}
        onDevice={setDevice}
        quickPreview={
          open
            ? {
                running:
                  quick.state.status === "running" ? quick.state.step : null,
                onRun: () => void quick.run(),
                shown: quickShown,
              }
            : null
        }
        files={read.status === "ready" ? read.files : null}
        diffOf={diffOf}
        checkpoints={checkpoints}
        checks={checks}
        build={{
          required: proposal?.staged?.buildRequired ?? false,
          building: state.building,
          progress,
          startedAt: state.startedAt,
          swapping,
          onBuild: open && build !== null ? () => void build() : null,
          onCancel: () => void cancel(),
        }}
        builder={
          canBuildHere()
            ? { kind: "in-tab" }
            : {
                kind: "window",
                // A build's builder tab, or a quick preview's.
                blocked: (state.inTab?.blocked ?? false) || quick.blocked,
              }
        }
        onOpenBuilder={openBuilder}
        problem={problem}
        preview={
          previewSrc !== null && addressOrigin !== null ? (
            // The Studio's canvas frame, at the proposal's origin: the page
            // picks any element itself and reports it described. The site's
            // edits are not relayed -- the page is the proposal's, and reads
            // its own. A new build is swapped in behind it.
            <DesignPreviewFrames
              address={address ?? addressOrigin}
              src={previewSrc}
              buildKey={builtHash}
              reloadKey={reloadKey}
              origin={addressOrigin}
              elementPicking={{
                active: picking,
                modifier: PICK_MODIFIER,
                keepPicked: picked !== null,
              }}
              onPickElement={(element) => {
                setPicking(false);
                setPicked(element);
              }}
              onElementPickingStopped={() => setPicking(false)}
              enableKey={enableKey}
              onStatusChange={setFrameStatus}
              onPageReader={setPageReader}
              onPageCamera={setPageCamera}
              onSwappingChange={setSwapping}
              quickPreviewId={quick.shownId}
              onQuickPreviewStorer={quick.setStorer}
              onFront={onFront}
            />
          ) : null
        }
        chat={
          <AIChatSurface
            className="h-full"
            design={{
              proposal: { name, displayName },
              pointedAt: picked,
              onPointedAtSent: () => setPicked(null),
              readPage: pageReader,
              screenshotPage: pageCamera,
              setDevice: showDevice,
              quickPreview: open ? quick.run : null,
            }}
          />
        }
      />
      <PublishProposalDialog
        open={publish.open}
        onOpenChange={publish.setOpen}
        displayName={displayName}
        state={publish.state}
        onPublish={publish.publish}
        onRetry={publish.retry}
        portalContainer={portalContainer}
      />
    </>
  );
}

/** Types, then Build: the checks a change goes through, as far as there are. */
function designChecks(
  proposal: ProposalJson | null,
  state: ReturnType<typeof useProposalBuild>["state"],
  progress: ReturnType<typeof useProposalBuild>["progress"],
): DesignCheckItem[] {
  const checks: DesignCheckItem[] = [];
  const staged = proposal?.staged ?? null;
  const typecheck = proposal?.typecheck ?? null;
  if (
    typecheck !== null &&
    staged !== null &&
    typecheck.inputs === staged.inputs
  ) {
    checks.push({
      label: "Types",
      check:
        typecheck.newErrors === 0
          ? { state: "passed" }
          : {
              state: "failed",
              message: `${typecheck.newErrors} new type ${typecheck.newErrors === 1 ? "error" : "errors"}`,
            },
    });
  }
  const last = state.last;
  checks.push({
    label: "Build",
    check: state.building
      ? { state: "running", percent: progress?.percent ?? null }
      : state.error !== null
        ? { state: "failed", message: state.error }
        : staged === null || staged.inputs === null
          ? { state: "idle", detail: "the site's code" }
          : staged.buildRequired
            ? {
                state: "idle",
                detail: last?.status === "cancelled" ? "cancelled" : "needed",
              }
            : {
                state: "passed",
                detail:
                  last?.status === "built"
                    ? `renders · built in ${Math.round(last.ms / 1000)}s`
                    : "renders",
              },
    // The steps of the build running, else of the last one: where the time went.
    ...(state.building
      ? { timings: state.timings }
      : last !== null && last.timings.length > 0
        ? { timings: last.timings }
        : {}),
  });
  return checks;
}

/** What went wrong, if anything, and what the person can do about it. */
function designProblem({
  quickError,
  studioProposal,
  read,
  proposal,
  buildError,
  onRetryRead,
  onBuild,
  onAskAssistant,
}: {
  studioProposal: { name: string } | null;
  read: Read;
  proposal: ProposalJson | null;
  buildError: string | null;
  onRetryRead: () => void;
  onBuild: (() => unknown) | null;
  onAskAssistant: (error: string) => void;
  quickError: string | null;
}): DesignProblem | null {
  if (studioProposal !== null) {
    const onSite =
      typeof window === "undefined"
        ? null
        : siteDesignTabUrl(window.location.href, studioProposal.name);
    return {
      title: "This is a proposal's address",
      message:
        "The design tab runs on the site, so that a build that breaks the proposal cannot take it down.",
      ...(onSite !== null
        ? {
            action: {
              label: "Open it on the site",
              onClick: () => window.location.assign(onSite),
            },
          }
        : {}),
    };
  }
  if (read.status === "error") {
    return {
      title: "The proposal could not be read",
      message:
        "Val could not read the proposal's files or the site's. Nothing was changed. Try again, and if it keeps failing, the details below say why.",
      details: read.message,
      action: { label: "Try again", onClick: onRetryRead },
    };
  }
  if (proposal !== null && proposal.status !== "open") {
    return {
      title: `This proposal is ${proposal.status === "needs-resolution" ? "waiting on a conflict" : proposal.status}`,
      message:
        "Only an open proposal's code is changed here. Its own Studio says what happened to it.",
    };
  }
  if (quickError !== null && buildError === null) {
    // Build, not Try again: most of what stops a quick preview -- a
    // dependency changed, a page with nothing to show it in, a browser that
    // cannot bundle -- a build gets past, and the same quick preview again
    // would only fail again.
    return {
      title: "The quick preview could not be shown",
      message:
        "The preview still shows what it showed before. Build the proposal to see the change, server and all.",
      details: quickError,
      ...(onBuild !== null
        ? { action: { label: "Build", onClick: () => void onBuild() } }
        : {}),
    };
  }
  if (buildError !== null) {
    return {
      title: "The build was not served",
      message:
        "The preview still shows the last build that worked. Ask the assistant to fix what the build says below, or build again.",
      details: buildError,
      onAskAssistant: () => onAskAssistant(buildError),
      ...(onBuild !== null
        ? { action: { label: "Try again", onClick: () => void onBuild() } }
        : {}),
    };
  }
  return null;
}

/**
 * The proposal's history, newest first: its saves and stagings. Read again
 * when its code may have changed, as the files are.
 */
function useCheckpoints(
  branch: string | null,
  changed: number,
): DesignCheckpoint[] | null {
  const client = useClient();
  const [commits, setCommits] = useState<HistoricalCommit[] | null>(null);
  useEffect(() => {
    if (branch === null) return;
    let cancelled = false;
    void client("/history/commits", "GET", {
      query: { branch, limit: 20, cursor: undefined },
    }).then((res) => {
      if (cancelled) return;
      // History is a help here, not the point: without it, none is shown.
      setCommits(res.status === 200 ? res.json.commits : []);
    });
    return () => {
      cancelled = true;
    };
  }, [branch, changed, client]);
  if (commits === null) return null;
  const now = Date.now();
  return commits.map((commit, index) => ({
    id: commit.commitSha,
    message: commit.message ?? "A change",
    ago: formatRelativeTime(commit.createdAt, now),
    current: index === 0,
  }));
}
