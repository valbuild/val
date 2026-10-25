import { z } from "zod";
import { callJson } from "../publish/callJson";

/*
 * Whether there is anything to upgrade, and the site's lockfile (valbuild/home
 * `docs/adept.md`, step 7, decision 19). Content answers both, through this
 * origin's publish proxy: the check from adept's audit and outdated reads,
 * kept per project for hours; the lockfile from where it records the site's.
 */

const UpgradePackage = z.object({
  name: z.string(),
  from: z.string(),
  to: z.string(),
});
/** A direct dependency an upgrade moves, from what to what. */
export type UpgradePackage = z.infer<typeof UpgradePackage>;

const Severity = z
  .enum(["low", "moderate", "high", "critical"])
  .nullable()
  .catch(null);

const UpgradeCheck = z.union([
  z.object({
    state: z.literal("unavailable"),
    reason: z.string(),
    message: z.string(),
  }),
  z.object({
    state: z.literal("checked"),
    checkedAt: z.string(),
    available: z.boolean(),
    cves: z.object({
      vulnerable: z.number(),
      /**
       * The vulnerabilities Security fixes would fix; absent from a content
       * that did not count them yet.
       */
      fixable: z.number().optional(),
      severity: Severity,
      packages: z.array(
        z.object({
          name: z.string(),
          version: z.string(),
          severity: z.string(),
        }),
      ),
    }),
    latest: z.object({
      packages: z.array(UpgradePackage),
      /** The Val release it moves to, when it moves Val. */
      val: z.object({ from: z.string(), to: z.string() }).nullish(),
    }),
    majors: z.object({ packages: z.array(UpgradePackage) }),
  }),
]);
/** What content's check says there is to upgrade. */
export type UpgradeCheck = z.infer<typeof UpgradeCheck>;
export type CheckedUpgrades = Extract<UpgradeCheck, { state: "checked" }>;

const DependencyFiles = z.object({
  files: z.record(z.string(), z.string()),
});

/** The three kinds of upgrade (decision 10). */
export type UpgradePath = "cves" | "latest" | "majors";

export type UpgradesClient = {
  /** Whether there is anything to upgrade. */
  check(): Promise<UpgradeCheck>;
  /**
   * The site's recorded `pnpm-lock.yaml` and `pnpm-workspace.yaml`. Empty
   * for a site made before proposals carried dependencies.
   */
  dependencyFiles(): Promise<Record<string, string>>;
};

export function createUpgradesClient(options: {
  /** This deployment's Val API, e.g. `/api/val`. */
  api: string;
  fetchImpl?: typeof fetch;
}): UpgradesClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const proxy = `${options.api.replace(/\/+$/, "")}/publish-api`;
  return {
    check: async () =>
      UpgradeCheck.parse(await callJson(fetchImpl, `${proxy}/upgrades`, "GET")),
    dependencyFiles: async () =>
      DependencyFiles.parse(
        await callJson(fetchImpl, `${proxy}/dependency-files`, "GET"),
      ).files,
  };
}

/** What a kind of upgrade would move, by the check. */
export function packagesOf(
  check: CheckedUpgrades,
  path: UpgradePath,
): { name: string; detail: string }[] {
  switch (path) {
    case "cves":
      return check.cves.packages.map((p) => ({
        name: p.name,
        detail: `${p.version}, ${p.severity}`,
      }));
    case "latest":
      return check.latest.packages.map((p) => ({
        name: p.name,
        detail: `${p.from} → ${p.to}`,
      }));
    case "majors":
      return check.majors.packages.map((p) => ({
        name: p.name,
        detail: `${p.from} → ${p.to}`,
      }));
  }
}

/** The name a proposal of a kind of upgrade is given. */
export function upgradeDisplayName(path: UpgradePath): string {
  switch (path) {
    case "cves":
      return "Security fixes";
    case "latest":
      return "Minor versions";
    case "majors":
      return "Full upgrade";
  }
}
