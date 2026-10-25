import { useEffect, useState } from "react";
import { AlertTriangle, ArrowUpCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "../components/designSystem/button";
import { firstKind, kindsOf, UpgradeKinds } from "./UpgradeKinds";
import type { UpgradeCheckState } from "./useUpgradeCheck";
import type { UpgradePath } from "./upgradesClient";

/**
 * What a person picks an upgrade with -- in the Upgrade dialog and in
 * Settings → Updates, which are the same thing in two places: the kinds the
 * check found something for, and **Create proposal**, which prepares one in
 * place (valbuild/home `docs/plans/upgrades-v2.md`, piece C) and then goes to
 * its page. Nothing changes on the site: the upgrade is built, typechecked
 * and rendered in the proposal, and published from there.
 */
export type UpgradeStart =
  | { status: "idle" }
  /** Created, and being prepared: `line` says where it is. */
  | { status: "preparing"; line: string }
  /** The upgrade moved nothing, and its proposal was closed again. */
  | { status: "nothing" }
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
  // The recommended kind, once the check says which there are.
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
  const first = firstKind(result);
  if (!result.available || first === null) {
    return (
      <p className="text-xs text-fg-secondary">
        {result.cves.vulnerable > 0
          ? `The site's dependencies are up to date. ${result.cves.vulnerable === 1 ? "1 package is" : `${result.cves.vulnerable} packages are`} vulnerable, with no fix an upgrade can take yet.`
          : "The site's dependencies are up to date, and none is vulnerable."}
      </p>
    );
  }
  const kinds = kindsOf(result);
  const chosen =
    path !== null && kinds.some((kind) => kind.path === path) ? path : first;
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
        disabled={start.status === "preparing"}
      />
      <p className="text-xs text-fg-secondary">
        The upgrade is made in a proposal of its own: its dependencies are built
        here first, then its page builds and typechecks it, and it is published
        when it adds no type errors and renders. Nothing on the site changes
        until then.
      </p>
      {start.status === "failed" && (
        <p role="alert" className="flex items-start gap-1.5 text-xs">
          <AlertTriangle
            size={14}
            className="mt-px shrink-0 text-fg-error-on-surface"
          />
          The upgrade could not be prepared: {start.message} Nothing on the site
          has changed.
        </p>
      )}
      {start.status === "nothing" && (
        <p role="status" className="text-xs text-fg-secondary">
          There was nothing for this kind of upgrade to move after all, so no
          proposal was kept.
        </p>
      )}
      <div className="flex flex-col items-start gap-1.5">
        <Button
          size="sm"
          disabled={start.status === "preparing" || allSkipped}
          onClick={() => onStart(chosen, chosen === "majors" ? skip : [])}
        >
          {start.status === "preparing" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ArrowUpCircle size={13} />
          )}
          {start.status === "preparing" ? "Preparing…" : "Create proposal"}
        </Button>
        {start.status === "preparing" && (
          <span role="status" className="text-xs text-fg-secondary">
            {start.line}
          </span>
        )}
      </div>
    </div>
  );
}
