import { useEffect, useState } from "react";
import { AlertTriangle, ArrowUpCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "../components/designSystem/button";
import { firstKind, kindsOf, UpgradeKinds } from "./UpgradeKinds";
import type { UpgradeCheckState } from "./useUpgradeCheck";
import type { UpgradePath } from "./upgradesClient";

/**
 * What a person picks an upgrade with -- in the Upgrade dialog and in
 * Settings → Updates, which are the same thing in two places: the kinds the
 * check found something for, and **Upgrade in a proposal**, which opens one
 * (valbuild/home `docs/adept.md`, step 7). Nothing changes on the site: the
 * upgrade is computed, built and typechecked in the proposal, and published
 * from there.
 */
export type UpgradeStart =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "failed"; message: string };

export function UpgradeChooser({
  check,
  start,
  onStart,
  onRecheck,
}: {
  check: UpgradeCheckState;
  start: UpgradeStart;
  onStart: (path: UpgradePath, skip: string[]) => void;
  /** Ask the check again: it failed, or the person wants a fresh one. */
  onRecheck: () => void;
}) {
  const checked =
    check.status === "checked" && check.check.state === "checked"
      ? check.check
      : null;
  const [path, setPath] = useState<UpgradePath | null>(null);
  const [skip, setSkip] = useState<string[]>([]);
  // The first kind with something to do, once the check says which.
  useEffect(() => {
    if (checked !== null && path === null) setPath(firstKind(checked));
  }, [checked, path]);

  if (check.status === "idle" || check.status === "checking") {
    return (
      <div className="flex items-center gap-2 text-xs text-fg-secondary">
        <Loader2 size={14} className="animate-spin" /> Checking the site&apos;s
        dependencies…
      </div>
    );
  }
  if (check.status === "failed") {
    return (
      <div className="flex flex-col items-start gap-2 text-xs">
        <p role="alert" className="flex items-start gap-1.5 text-fg-primary">
          <AlertTriangle
            size={14}
            className="mt-px shrink-0 text-fg-error-on-surface"
          />
          Val Build could not say whether there is anything to upgrade:{" "}
          {check.message}
        </p>
        <Button size="sm" variant="outline" onClick={onRecheck}>
          <RefreshCw size={13} /> Try again
        </Button>
      </div>
    );
  }
  if (check.check.state === "unavailable") {
    return <p className="text-xs text-fg-secondary">{check.check.message}</p>;
  }
  const result = check.check;
  if (!result.available) {
    return (
      <p className="text-xs text-fg-secondary">
        The site&apos;s dependencies are up to date, and none is vulnerable.
      </p>
    );
  }
  const chosen = path ?? firstKind(result);
  const nothing =
    kindsOf(result).find((kind) => kind.path === chosen)?.empty ?? true;
  const allSkipped =
    chosen === "majors" &&
    result.majors.packages.every((p) => skip.includes(p.name));
  return (
    <div className="flex flex-col gap-3">
      <UpgradeKinds
        check={result}
        path={chosen}
        onPath={setPath}
        skip={skip}
        onSkip={setSkip}
        disabled={start.status === "starting"}
      />
      <p className="text-xs text-fg-secondary">
        The upgrade is made in a proposal of its own: built and typechecked
        there, and published when it adds no type errors. Nothing on the site
        changes until then.
      </p>
      {start.status === "failed" && (
        <p role="alert" className="flex items-start gap-1.5 text-xs">
          <AlertTriangle
            size={14}
            className="mt-px shrink-0 text-fg-error-on-surface"
          />
          The proposal was not opened: {start.message} Press Upgrade in a
          proposal to try again.
        </p>
      )}
      <div>
        <Button
          size="sm"
          disabled={start.status === "starting" || nothing || allSkipped}
          onClick={() => onStart(chosen, chosen === "majors" ? skip : [])}
        >
          {start.status === "starting" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ArrowUpCircle size={13} />
          )}
          {start.status === "starting"
            ? "Opening the proposal…"
            : "Upgrade in a proposal"}
        </Button>
      </div>
    </div>
  );
}
