import { ShieldAlert } from "lucide-react";
import { Checkbox } from "../components/designSystem/checkbox";
import { cn } from "../components/designSystem/cn";
import {
  RadioGroup,
  RadioGroupItem,
} from "../components/designSystem/radio-group";
import type { CheckedUpgrades, UpgradePath } from "./upgradesClient";

/*
 * The three kinds of upgrade (valbuild/home `docs/adept.md`, decision 10;
 * `docs/plans/upgrades-v2.md`, piece A), as the Upgrade dialog and Settings →
 * Updates both offer them: only the ones that move something, each by what
 * it moves -- counts, and the Val it moves to. Which packages is folded
 * away; there the majors are each a box to leave one out.
 */

/** A kind of upgrade the check found something for. */
export type UpgradeKind = {
  path: UpgradePath;
  title: string;
  detail: string;
  recommended: boolean;
};

const VAL_SCOPE = "@valbuild/";

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The vulnerabilities Security fixes would fix. A check from before content
 * counted them says how many packages are vulnerable instead.
 */
export function fixableOf(check: CheckedUpgrades): number {
  return check.cves.fixable ?? check.cves.vulnerable;
}

/** The kinds of upgrade that move something, in the order they are offered. */
export function kindsOf(check: CheckedUpgrades): UpgradeKind[] {
  const kinds: UpgradeKind[] = [];
  const fixable = fixableOf(check);
  if (fixable > 0) {
    kinds.push({
      path: "cves",
      title: "Security fixes",
      detail: `Fixes ${plural(fixable, "vulnerability", "vulnerabilities")}${check.cves.severity ? `, the worst ${check.cves.severity}` : ""}, with the smallest change that does.`,
      recommended: false,
    });
  }
  const latest = check.latest.packages;
  if (latest.length > 0) {
    const val = check.latest.val ?? null;
    const others = latest.filter((p) => !p.name.startsWith(VAL_SCOPE)).length;
    const rest = plural(others, "dependency", "dependencies");
    kinds.push({
      path: "latest",
      title: "Minor versions",
      detail:
        val !== null
          ? `Val ${val.from} → ${val.to}${others > 0 ? `, and ${rest} to the newest version of their major` : ""}.`
          : `${plural(latest.length, "dependency", "dependencies")} to the newest version of their major.`,
      recommended: true,
    });
  }
  const majors = check.majors.packages;
  if (majors.length > 0) {
    kinds.push({
      path: "majors",
      title: "Full",
      detail: `Minor versions, and ${plural(majors.length, "dependency", "dependencies")} onto a new major version. A new major can change how a dependency works: the upgrade is built and typechecked before it can be published.`,
      recommended: false,
    });
  }
  return kinds;
}

/** The kind offered first: the recommended one when there is one. */
export function firstKind(check: CheckedUpgrades): UpgradePath | null {
  const kinds = kindsOf(check);
  return (kinds.find((kind) => kind.recommended) ?? kinds[0])?.path ?? null;
}

export function UpgradeKinds({
  check,
  path,
  onPath,
  skip,
  onSkip,
  disabled = false,
}: {
  check: CheckedUpgrades;
  path: UpgradePath;
  onPath: (path: UpgradePath) => void;
  /** Majors left out, by package name. */
  skip: string[];
  onSkip: (skip: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <RadioGroup
      value={path}
      onValueChange={(value) => {
        const chosen = kindsOf(check).find((kind) => kind.path === value);
        if (chosen) onPath(chosen.path);
      }}
      disabled={disabled}
      className="gap-3"
    >
      {kindsOf(check).map((kind) => (
        <div
          key={kind.path}
          className={cn(
            "flex flex-col gap-2 rounded-md border px-3 py-2.5",
            path === kind.path
              ? "border-border-brand-primary"
              : "border-border-float",
          )}
        >
          <label className="flex cursor-pointer items-start gap-2.5">
            <RadioGroupItem
              value={kind.path}
              disabled={disabled}
              className="mt-0.5"
              aria-label={kind.title}
            />
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-fg-primary">
                {kind.path === "cves" && (
                  <ShieldAlert
                    size={13}
                    className="text-fg-error-on-surface"
                    aria-hidden
                  />
                )}
                {kind.title}
                {kind.recommended && (
                  <span className="font-normal text-fg-secondary">
                    (recommended)
                  </span>
                )}
              </span>
              <span className="text-xs text-fg-secondary">{kind.detail}</span>
            </span>
          </label>
          {path === kind.path && (
            <details className="ml-6 text-xs text-fg-secondary">
              <summary className="cursor-pointer select-none">Which</summary>
              {kind.path === "latest" && (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {check.latest.packages.map((p) => (
                    <li key={p.name}>
                      <span className="font-mono text-fg-primary">
                        {p.name}
                      </span>{" "}
                      {p.from} → {p.to}
                    </li>
                  ))}
                </ul>
              )}
              {kind.path === "cves" && (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {check.cves.packages.map((p) => (
                    <li key={`${p.name}@${p.version}`}>
                      <span className="font-mono text-fg-primary">
                        {p.name}
                      </span>{" "}
                      {p.version}, {p.severity}
                    </li>
                  ))}
                </ul>
              )}
              {kind.path === "majors" && (
                <ul className="mt-1 flex flex-col gap-1">
                  {check.majors.packages.map((p) => {
                    const moves = !skip.includes(p.name);
                    return (
                      <li key={p.name}>
                        <label className="flex cursor-pointer items-center gap-2">
                          <Checkbox
                            checked={moves}
                            disabled={disabled}
                            onCheckedChange={(checked) =>
                              onSkip(
                                checked === true
                                  ? skip.filter((name) => name !== p.name)
                                  : [...skip, p.name],
                              )
                            }
                            aria-label={`Upgrade ${p.name}`}
                          />
                          <span
                            className={cn(
                              moves ? "text-fg-primary" : "text-fg-secondary",
                            )}
                          >
                            <span className="font-mono">{p.name}</span> {p.from}{" "}
                            → {p.to}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </details>
          )}
        </div>
      ))}
    </RadioGroup>
  );
}
