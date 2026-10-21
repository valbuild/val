import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowUpCircle } from "lucide-react";
import { useStudioIsDeployer } from "../components/ValProvider";
import type { ProposalCodeState } from "../components/proposals/types";
import {
  sameStudioPageAt,
  type ProposalJson,
  type ProposalsClient,
} from "../proposals/proposalsClient";
import { waitForAddress } from "../proposals/useProposals";
import type { ProposalTypecheckState } from "../proposals/useProposalTypecheck";
import { randomUUID } from "../utils/randomUUID";
import type { UpgradeStart } from "./UpgradeChooser";
import { UpgradeDialog } from "./UpgradeDialog";
import { UpgradeProgressDialog } from "./UpgradeProgressDialog";
import { upgradeProgressOf } from "./upgradeProgress";
import { useUpgradeCheck, type UpgradeCheckState } from "./useUpgradeCheck";
import { upgradeDisplayName, type UpgradePath } from "./upgradesClient";

/*
 * The Upgrade (valbuild/home `docs/adept.md`, step 7, "How one Upgrade goes"):
 * the button, shown while the check says there is something; its dialog,
 * which opens an upgrade proposal; and, at that proposal's address, the same
 * dialog following it to Publish -- computed, its dependencies built,
 * typechecked, built. The proposal is otherwise an ordinary one: Build and
 * Publish are the proposals bar's.
 */

/** A query parameter: the upgrade dialog opens on arrival at the proposal. */
const UPGRADE_PARAM = "val-upgrade";

export function withUpgradeDialog(url: string): string {
  const next = new URL(url);
  next.searchParams.set(UPGRADE_PARAM, "1");
  return next.href;
}

export function upgradeDialogAsked(url: string): boolean {
  return new URL(url).searchParams.get(UPGRADE_PARAM) === "1";
}

export function withoutUpgradeDialog(url: string): string {
  const next = new URL(url);
  next.searchParams.delete(UPGRADE_PARAM);
  return next.href;
}

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
  client: ProposalsClient;
  here: { name: string } | null;
  current: ProposalJson | null;
  code: ProposalCodeState | null;
  typecheck: ProposalTypecheckState;
  onTypecheck: (() => void) | null;
  onComputeLockfile: () => void;
  onBuild: () => void;
  onPublish: () => void;
  onRefresh: () => void;
  portalContainer?: HTMLElement | null;
}): {
  /** `null` while there is nothing to upgrade, or nobody here can. */
  button: UpgradeButton | null;
  /** `null` where this Studio does not upgrade. */
  settings: UpgradeSettings | null;
  dialogs: ReactNode;
  /** At an upgrade proposal's address: where it is, and the way back in. */
  notice: ReactNode | null;
} {
  const { enabled, client, here, current, onRefresh } = input;
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
  const onStart = useCallback(
    async (path: UpgradePath, skip: string[]) => {
      setStart({ status: "starting" });
      try {
        const made = await client.create({
          requestId: requestId.current,
          displayName: upgradeDisplayName(path),
          kind: "upgrade",
          upgrade: { path, ...(skip.length > 0 ? { skip } : {}) },
        });
        onRefresh();
        const origin =
          made.address ?? (await waitForAddress(client, made.name));
        window.location.assign(
          withUpgradeDialog(sameStudioPageAt(origin, window.location)),
        );
      } catch (error) {
        setStart({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [client, onRefresh],
  );

  // At an upgrade proposal's address: its dialog, opened on arrival.
  const upgrade =
    here !== null && current !== null && current.name === here.name
      ? (current.upgrade ?? null)
      : null;
  const [following, setFollowing] = useState(false);
  const asked = useRef(false);
  useEffect(() => {
    if (here === null || asked.current) return;
    if (!upgradeDialogAsked(window.location.href)) return;
    asked.current = true;
    window.history.replaceState(
      window.history.state,
      "",
      withoutUpgradeDialog(window.location.href),
    );
    setFollowing(true);
  }, [here]);
  // Content computes the upgrade on its own: read it again until it has.
  const computing = upgrade?.state === "computing";
  useEffect(() => {
    if (!computing) return;
    const timer = setInterval(onRefresh, 3_000);
    return () => clearInterval(timer);
  }, [computing, onRefresh]);

  const view = useMemo(
    () =>
      upgrade !== null && current !== null
        ? upgradeProgressOf({
            proposal: current,
            upgrade,
            typecheck: input.typecheck,
            code: input.code,
          })
        : null,
    [upgrade, current, input.typecheck, input.code],
  );

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
        onStart: (path, skip) => void onStart(path, skip),
        onRecheck: recheck,
      }
    : null;

  const {
    onTypecheck,
    onComputeLockfile,
    onBuild,
    onPublish,
    portalContainer,
  } = input;
  const dialogs = (
    <>
      {usable && (
        <UpgradeDialog
          open={choosing}
          onOpenChange={setChoosing}
          check={check}
          start={start}
          onStart={(path, skip) => void onStart(path, skip)}
          onRecheck={recheck}
          portalContainer={portalContainer}
        />
      )}
      {view !== null && current !== null && (
        <UpgradeProgressDialog
          open={following}
          onOpenChange={setFollowing}
          displayName={current.displayName}
          view={view}
          onComputeLockfile={onComputeLockfile}
          onTypecheck={() => onTypecheck?.()}
          onBuild={onBuild}
          onPublish={() => {
            setFollowing(false);
            onPublish();
          }}
          portalContainer={portalContainer}
        />
      )}
    </>
  );
  const notice =
    view !== null && current !== null && current.status === "open" ? (
      <div
        role="status"
        className="flex items-center justify-between gap-3 rounded-lg border border-border-proposal bg-bg-proposal-soft px-4 py-3 text-xs text-fg-primary"
      >
        <span className="flex items-center gap-2">
          <ArrowUpCircle size={14} className="shrink-0 text-fg-proposal" />
          {view.upgrade.state === "computing"
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
                    : "The upgrade is being checked."}
        </span>
        <button
          type="button"
          onClick={() => setFollowing(true)}
          className="inline-flex h-7 shrink-0 items-center rounded-md border border-border-proposal px-2 font-medium hover:bg-bg-proposal-soft"
        >
          Open
        </button>
      </div>
    ) : null;
  return { button, settings, dialogs, notice };
}
