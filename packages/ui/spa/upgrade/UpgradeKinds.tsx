import { ShieldAlert } from "lucide-react";
import { Checkbox } from "../components/designSystem/checkbox";
import { cn } from "../components/designSystem/cn";
import {
  RadioGroup,
  RadioGroupItem,
} from "../components/designSystem/radio-group";
import type { CheckedUpgrades, UpgradePath } from "./upgradesClient";

/*
 * The three kinds of upgrade (valbuild/home `docs/adept.md`, decision 10), as
 * the Upgrade dialog and Settings → Updates both offer them: each with what
 * the check says it moves, a vulnerability fix first. Majors are listed one
 * by one, each one a box to leave it out.
 */

/** A kind of upgrade, and whether there is anything for it to do. */
export function kindsOf(check: CheckedUpgrades): {
  path: UpgradePath;
  title: string;
  detail: string;
  empty: boolean;
}[] {
  const plural = (n: number, one: string, many = `${one}s`) =>
    `${n} ${n === 1 ? one : many}`;
  return [
    {
      path: "cves",
      title: "Fix vulnerabilities",
      detail:
        check.cves.vulnerable > 0
          ? `${plural(check.cves.vulnerable, "vulnerable package")}${check.cves.severity ? `, the worst ${check.cves.severity}` : ""}. Only the smallest change that fixes them, kept only when it does.`
          : "No vulnerable packages.",
      empty: check.cves.vulnerable === 0,
    },
    {
      path: "latest",
      title: "Latest within the major",
      detail:
        check.latest.packages.length > 0
          ? `${plural(check.latest.packages.length, "dependency", "dependencies")} to the newest version of the major it is on.`
          : "Every dependency is on the newest version of its major.",
      empty: check.latest.packages.length === 0,
    },
    {
      path: "majors",
      title: "New major versions",
      detail:
        check.majors.packages.length > 0
          ? `${plural(check.majors.packages.length, "dependency", "dependencies")} with a new major version. These can change how they work: the upgrade is typechecked, and it is published only when it adds no type errors.`
          : "No dependency has a new major version.",
      empty: check.majors.packages.length === 0,
    },
  ];
}

/** The kind offered first: a vulnerability fix when there is one. */
export function firstKind(check: CheckedUpgrades): UpgradePath {
  return kindsOf(check).find((kind) => !kind.empty)?.path ?? "cves";
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
              disabled={disabled || kind.empty}
              className="mt-0.5"
              aria-label={kind.title}
            />
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-fg-primary">
                {kind.path === "cves" && !kind.empty && (
                  <ShieldAlert
                    size={13}
                    className="text-fg-error-on-surface"
                    aria-hidden
                  />
                )}
                {kind.title}
              </span>
              <span className="text-xs text-fg-secondary">{kind.detail}</span>
            </span>
          </label>
          {kind.path === "latest" &&
            path === "latest" &&
            check.latest.packages.length > 0 && (
              <ul className="ml-6 flex flex-col gap-0.5 text-xs text-fg-secondary">
                {check.latest.packages.map((p) => (
                  <li key={p.name}>
                    <span className="font-mono text-fg-primary">{p.name}</span>{" "}
                    {p.from} → {p.to}
                  </li>
                ))}
              </ul>
            )}
          {kind.path === "cves" &&
            path === "cves" &&
            check.cves.packages.length > 0 && (
              <ul className="ml-6 flex flex-col gap-0.5 text-xs text-fg-secondary">
                {check.cves.packages.map((p) => (
                  <li key={`${p.name}@${p.version}`}>
                    <span className="font-mono text-fg-primary">{p.name}</span>{" "}
                    {p.version}, {p.severity}
                  </li>
                ))}
              </ul>
            )}
          {kind.path === "majors" &&
            path === "majors" &&
            check.majors.packages.length > 0 && (
              <ul className="ml-6 flex flex-col gap-1 text-xs">
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
                          <span className="font-mono">{p.name}</span> {p.from} →{" "}
                          {p.to}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      ))}
    </RadioGroup>
  );
}
