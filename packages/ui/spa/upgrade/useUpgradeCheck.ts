import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  createUpgradesClient,
  type UpgradeCheck,
  type UpgradesClient,
} from "./upgradesClient";

/**
 * Whether there is anything to upgrade (valbuild/home `docs/adept.md`,
 * decision 19), asked once when the Studio opens and kept: content keeps the
 * answer for hours too, because advisories are published without the project
 * changing, but a Studio left open does not need to ask more often than that.
 * Shared by the Upgrade button and Settings → Updates.
 */
export type UpgradeCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "checked"; check: UpgradeCheck; at: number }
  | { status: "failed"; message: string };

/** How long an answer is kept before it is asked for again. */
export const UPGRADE_CHECK_MAX_AGE_MS = 3 * 60 * 60 * 1000;

const IDLE: UpgradeCheckState = { status: "idle" };
let current: UpgradeCheckState = IDLE;
const listeners = new Set<() => void>();
function set(next: UpgradeCheckState) {
  current = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const snapshot = () => current;

let asking: Promise<void> | null = null;

/** For tests: back to never asked. */
export function resetUpgradeCheck() {
  current = IDLE;
  asking = null;
}

/** Ask for the check, or join the asking already going on. */
export function askUpgradeCheck(client: UpgradesClient): Promise<void> {
  if (asking !== null) return asking;
  set({ status: "checking" });
  asking = client
    .check()
    .then(
      (check) => set({ status: "checked", check, at: Date.now() }),
      (error) =>
        set({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        }),
    )
    .finally(() => {
      asking = null;
    });
  return asking;
}

/** Whether an answer is due: none yet, or one older than the maximum age. */
export function checkIsDue(state: UpgradeCheckState, now: number): boolean {
  if (state.status === "idle") return true;
  if (state.status === "checked")
    return now - state.at > UPGRADE_CHECK_MAX_AGE_MS;
  return false;
}

export function useUpgradeCheck(options: {
  /** Ask only in a Studio that deploys: elsewhere there is nothing to upgrade. */
  enabled: boolean;
  client?: UpgradesClient;
}): { state: UpgradeCheckState; recheck: () => void } {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { enabled, client } = options;
  const recheck = useCallback(() => {
    void askUpgradeCheck(client ?? createUpgradesClient({ api: "/api/val" }));
  }, [client]);
  useEffect(() => {
    if (!enabled) return;
    if (checkIsDue(current, Date.now())) recheck();
    const timer = setInterval(() => {
      if (checkIsDue(current, Date.now())) recheck();
    }, UPGRADE_CHECK_MAX_AGE_MS);
    return () => clearInterval(timer);
  }, [enabled, recheck]);
  return { state, recheck };
}
