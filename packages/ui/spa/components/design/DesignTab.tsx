import { useEffect, useMemo, useRef, useState } from "react";
import { createStudioPublishClient } from "@valbuild/shared/publish";
import type { HistoricalCommit } from "@valbuild/shared/internal";
import { AIChatSurface } from "../AIChatSurface";
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
  DesignTabView,
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
  const { state, build, progress } = useProposalBuild(proposals, name);
  const { askAssistant } = useAIChatActions();

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

  // The frame shows the last build until a new one is served: reload it
  // then. Not on the first read, which is what it mounted with.
  const [reloadKey, setReloadKey] = useState(0);
  const builtHash =
    proposal === null ? undefined : (proposal.built?.hash ?? null);
  const lastBuilt = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (builtHash === undefined) return;
    if (lastBuilt.current !== undefined && builtHash !== lastBuilt.current) {
      setReloadKey((key) => key + 1);
    }
    lastBuilt.current = builtHash;
  }, [builtHash]);

  const [route, setRoute] = useState("/");
  const address = proposal?.address ?? null;
  // A route that is not a page of the proposal's address shows nothing.
  const previewSrc = address !== null ? previewUrl(address, route) : null;

  const checks = designChecks(proposal, state, progress);
  const problem = designProblem({
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

  const open = proposal?.status === "open";
  return (
    <DesignTabView
      proposal={{ displayName, address }}
      previewHref={previewSrc}
      studioUrl={address !== null ? new URL("/val", address).toString() : null}
      route={route}
      onRouteChange={setRoute}
      onReload={() => setReloadKey((key) => key + 1)}
      files={read.status === "ready" ? read.files : null}
      diffOf={diffOf}
      checkpoints={checkpoints}
      checks={checks}
      build={{
        required: proposal?.staged?.buildRequired ?? false,
        building: state.building,
        progress,
        onBuild: open && build !== null ? () => void build() : null,
      }}
      builder={
        canBuildHere()
          ? { kind: "in-tab" }
          : { kind: "window", blocked: state.inTab?.blocked ?? false }
      }
      onOpenBuilder={openBuilder}
      problem={problem}
      preview={
        previewSrc !== null ? (
          <iframe
            key={`${previewSrc}#${reloadKey}`}
            title={`${displayName}, ${route}`}
            src={previewSrc}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        ) : null
      }
      chat={
        <AIChatSurface
          className="h-full"
          design={{ proposal: { name, displayName } }}
        />
      }
    />
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
  checks.push({
    label: "Build",
    check: state.building
      ? { state: "running", percent: progress?.percent ?? null }
      : state.error !== null
        ? { state: "failed", message: state.error }
        : staged === null || staged.inputs === null
          ? { state: "idle", detail: "the site's code" }
          : staged.buildRequired
            ? { state: "idle", detail: "needed" }
            : { state: "passed", detail: "renders" },
  });
  return checks;
}

/** What went wrong, if anything, and what the person can do about it. */
function designProblem({
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
  if (buildError !== null) {
    return {
      title: "The build was not served",
      message:
        "The preview still shows the last build that worked. Ask the assistant to fix what the build says below, or build again.",
      details: buildError,
      onAskAssistant: () => onAskAssistant(buildError),
      ...(onBuild !== null
        ? { action: { label: "Build again", onClick: () => void onBuild() } }
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
