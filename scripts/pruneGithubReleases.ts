/**
 * Deletes the GitHub Releases that carry no release notes.
 *
 *   GITHUB_TOKEN=$(gh auth token) pnpm prune:github-releases          # dry run
 *   GITHUB_TOKEN=$(gh auth token) pnpm prune:github-releases --apply  # delete
 *
 * Every release is published by `changesets/action`, one per package per
 * version, so a single version puts one row per package on the Releases page.
 * Until 0.117.0 the changelogs were generated empty (#579), so every release up
 * to that point has an empty body: 1600-odd rows saying nothing that npm does
 * not say better. This deletes those and keeps the ones worth reading.
 *
 * A release is KEPT when any of these holds:
 *
 *   - its body is not empty — it has a changelog entry, which is the whole
 *     point of the page;
 *   - it carries assets — a release with a download attached is the only copy
 *     of that download, so deleting it destroys bytes rather than a row;
 *   - it is a draft, or immutable — GitHub will not let us delete an immutable
 *     release anyway, and a draft is not on the public page to begin with;
 *   - it is one of the project's first releases (every release sharing the
 *     oldest release's version), so the page still starts where the project
 *     did. `--no-keep-first` drops that rule, `--keep <tag>` adds more.
 *
 * DELETING A RELEASE DOES NOT DELETE ITS TAG. The tags stay, so `git describe`,
 * every permalink to a tag and every `npm view` still resolve. What goes is the
 * Releases-page entry.
 *
 * The dry run writes the full plan to `.github-releases-prune.json` so it can
 * be read before anything is deleted. Deletion is throttled and resumable: the
 * plan is recomputed from the live list on every run, so an interrupted run is
 * just re-run.
 */
import fs from "node:fs";

export type Release = {
  id: number;
  tag_name: string;
  body: string | null;
  draft: boolean;
  immutable?: boolean;
  created_at: string;
  html_url: string;
  assets: { id: number; name: string }[];
};

export type Options = {
  apply: boolean;
  keepFirst: boolean;
  keepTags: Set<string>;
  delayMs: number;
  repo: string;
  reportPath: string;
};

export const DEFAULTS = {
  repo: "valbuild/val",
  /**
   * GitHub asks for a pause between mutative requests and enforces it with a
   * secondary rate limit — not the one in the `X-RateLimit-*` headers, and not
   * one you can read your way out of. One per second is their own
   * recommendation; 1660 deletes is then ~28 minutes, which is the price of not
   * being throttled halfway through.
   */
  delayMs: 1000,
  reportPath: ".github-releases-prune.json",
};

export const KEEP_REASONS = {
  body: "has release notes",
  assets: "has assets attached",
  draft: "is a draft",
  immutable: "is immutable",
  first: "is one of the first releases",
  explicit: "kept by --keep",
} as const;

export type KeepReason = (typeof KEEP_REASONS)[keyof typeof KEEP_REASONS];

export const USAGE = `Usage: pnpm prune:github-releases [options]

  --apply            Actually delete. Without it, nothing is deleted.
  --no-keep-first    Do not keep the project's first releases.
  --keep <tag>       Keep this tag too. Repeatable.
  --delay <ms>       Pause between deletes (default ${DEFAULTS.delayMs}).
  --repo <o/r>       Repository (default ${DEFAULTS.repo}).
  --report <path>    Where to write the plan (default ${DEFAULTS.reportPath}).

Needs GITHUB_TOKEN (or GH_TOKEN) with write access to the repository.
A fine-grained token needs Contents: read and write.`;

export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    apply: false,
    keepFirst: true,
    keepTags: new Set(),
    delayMs: DEFAULTS.delayMs,
    repo: DEFAULTS.repo,
    reportPath: DEFAULTS.reportPath,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`${arg} needs a value`);
      }
      return value;
    };
    switch (arg) {
      case "--apply":
        opts.apply = true;
        break;
      case "--no-keep-first":
        opts.keepFirst = false;
        break;
      case "--keep":
        opts.keepTags.add(next());
        break;
      case "--delay": {
        const delay = Number(next());
        if (!Number.isFinite(delay) || delay < 0) {
          throw new Error("--delay must be a non-negative number of ms");
        }
        opts.delayMs = delay;
        break;
      }
      case "--repo":
        opts.repo = next();
        break;
      case "--report":
        opts.reportPath = next();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  return opts;
}

/** The version off a `@scope/name@1.2.3` tag, or null if it is not shaped like one. */
export function versionOf(tag: string): string | null {
  const at = tag.lastIndexOf("@");
  return at > 0 ? tag.slice(at + 1) : null;
}

/**
 * The version of the project's first releases.
 *
 * The oldest release is not one release: a version publishes every package at
 * once, so the first release is however many packages existed on day one, all
 * sharing a timestamp and a version. Keeping the single oldest row would leave
 * two of its siblings deleted and one kept, for no reason a reader of the page
 * could see.
 */
export function firstVersions(releases: Release[]): Set<string> {
  const oldest = releases.reduce<Release | null>(
    (min, r) => (min === null || r.created_at < min.created_at ? r : min),
    null,
  );
  const version = oldest && versionOf(oldest.tag_name);
  return new Set(version ? [version] : []);
}

export function keepReason(
  release: Release,
  opts: Pick<Options, "keepTags" | "keepFirst">,
  first: Set<string>,
): KeepReason | null {
  if (opts.keepTags.has(release.tag_name)) return KEEP_REASONS.explicit;
  if ((release.body ?? "").trim() !== "") return KEEP_REASONS.body;
  if (release.assets.length > 0) return KEEP_REASONS.assets;
  if (release.draft) return KEEP_REASONS.draft;
  if (release.immutable) return KEEP_REASONS.immutable;
  const version = versionOf(release.tag_name);
  if (opts.keepFirst && version !== null && first.has(version)) {
    return KEEP_REASONS.first;
  }
  return null;
}

export type Plan = {
  keep: { release: Release; reason: KeepReason }[];
  delete: Release[];
};

/** Splits the releases into what stays and what goes. Deletions oldest first. */
export function planPrune(releases: Release[], opts: Options): Plan {
  const first = opts.keepFirst ? firstVersions(releases) : new Set<string>();
  const plan: Plan = { keep: [], delete: [] };
  for (const release of releases) {
    const reason = keepReason(release, opts, first);
    if (reason === null) {
      plan.delete.push(release);
    } else {
      plan.keep.push({ release, reason });
    }
  }
  plan.delete.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return plan;
}

function token(): string {
  const value = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!value) {
    throw new Error(
      "No GITHUB_TOKEN (or GH_TOKEN) in the environment.\n" +
        "With the gh CLI:  GITHUB_TOKEN=$(gh auth token) pnpm prune:github-releases",
    );
  }
  return value;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function api(path: string, method = "GET"): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token()}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "valbuild-prune-github-releases",
    },
  });
}

/**
 * Retries the two failures that are expected rather than exceptional: a
 * secondary rate limit (403/429 — what throttling too fast looks like) and a
 * 5xx. Anything else comes back for the caller to decide on; a 404 on a delete
 * means someone else got there first, which is a success, not a retry.
 */
async function apiWithRetry(
  path: string,
  method = "GET",
  attempt = 1,
): Promise<Response> {
  const res = await api(path, method);
  const retryable =
    res.status === 403 || res.status === 429 || res.status >= 500;
  if (!retryable || attempt > 5) {
    return res;
  }
  const retryAfter = Number(res.headers.get("retry-after") ?? "0");
  const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
  console.warn(
    `  ${res.status} on ${path} — waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt}/5)`,
  );
  await sleep(waitMs);
  return apiWithRetry(path, method, attempt + 1);
}

async function listAllReleases(repo: string): Promise<Release[]> {
  const releases: Release[] = [];
  for (let page = 1; ; page++) {
    const res = await apiWithRetry(
      `/repos/${repo}/releases?per_page=100&page=${page}`,
    );
    if (!res.ok) {
      throw new Error(
        `Listing releases failed: ${res.status} ${await res.text()}`,
      );
    }
    // `res.json()` is `any`, so this is an annotation rather than an
    // assertion: nothing is being overridden, the boundary is being named.
    const batch: Release[] = await res.json();
    releases.push(...batch);
    process.stdout.write(`\rFetched ${releases.length} releases…`);
    if (batch.length < 100) {
      break;
    }
  }
  process.stdout.write("\n");
  return releases;
}

async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const opts = parseArgs(argv);
  token(); // fail before the first request rather than after it

  console.log(`Repository: ${opts.repo}`);
  const releases = await listAllReleases(opts.repo);
  if (releases.length === 0) {
    console.log("No releases.");
    return;
  }

  const plan = planPrune(releases, opts);

  const byReason = new Map<KeepReason, string[]>();
  for (const { release, reason } of plan.keep) {
    const tags = byReason.get(reason) ?? [];
    tags.push(release.tag_name);
    byReason.set(reason, tags);
  }

  console.log(
    `\n${releases.length} releases: keeping ${plan.keep.length}, deleting ${plan.delete.length}.\n`,
  );
  console.log("Keeping:");
  for (const [reason, tags] of byReason) {
    const shown = tags.slice(0, 8).join(", ");
    const more = tags.length > 8 ? `, … (${tags.length} total)` : "";
    console.log(`  ${reason} — ${shown}${more}`);
  }

  fs.writeFileSync(
    opts.reportPath,
    JSON.stringify(
      {
        repo: opts.repo,
        generatedAt: new Date().toISOString(),
        keep: plan.keep.map(({ release, reason }) => ({
          tag: release.tag_name,
          reason,
          url: release.html_url,
        })),
        delete: plan.delete.map((r) => ({
          id: r.id,
          tag: r.tag_name,
          created_at: r.created_at,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nFull plan written to ${opts.reportPath}`);

  if (plan.delete.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  if (!opts.apply) {
    const minutes = Math.ceil((plan.delete.length * opts.delayMs) / 60000);
    console.log(
      `\nWould delete ${plan.delete.length} releases, oldest first, starting with:\n` +
        plan.delete
          .slice(0, 5)
          .map((r) => `  ${r.tag_name}`)
          .join("\n") +
        `\n\nTags are NOT touched — only the Releases-page entries.` +
        `\nRe-run with --apply to delete. At ${opts.delayMs}ms apart that takes about ${minutes} minutes.`,
    );
    return;
  }

  console.log(
    `\nDeleting ${plan.delete.length} releases. Tags are not touched.`,
  );
  let deleted = 0;
  const failed: { tag: string; status: number; body: string }[] = [];
  for (const release of plan.delete) {
    const res = await apiWithRetry(
      `/repos/${opts.repo}/releases/${release.id}`,
      "DELETE",
    );
    if (res.status === 204 || res.status === 404) {
      deleted++;
    } else {
      failed.push({
        tag: release.tag_name,
        status: res.status,
        body: (await res.text()).slice(0, 200),
      });
      console.warn(`\n  failed: ${release.tag_name} — ${res.status}`);
    }
    process.stdout.write(
      `\r${deleted + failed.length}/${plan.delete.length} (${failed.length} failed)…`,
    );
    await sleep(opts.delayMs);
  }
  process.stdout.write("\n");

  console.log(`\nDeleted ${deleted} releases.`);
  if (failed.length > 0) {
    console.log(`${failed.length} failed:`);
    for (const f of failed.slice(0, 20)) {
      console.log(`  ${f.tag} — ${f.status} ${f.body}`);
    }
    console.log(
      "Re-run to retry: the plan is recomputed from the live list every time.",
    );
    process.exitCode = 1;
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
