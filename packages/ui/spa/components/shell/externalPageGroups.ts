import { ShellExternalPage } from "./types";
import {
  NOT_A_URL_GROUP,
  ParsedExternalUrl,
  parseExternalUrl,
} from "./externalUrls";
import {
  ExternalUrlIssue,
  ExternalUrlStatus,
  statusOf,
} from "./externalUrlChecks";
import { ExternalUrlProbe, probeIssues } from "./externalUrlReachability";

/** One external page, with everything the list derives from its URL. */
export type ExternalPageRowData = {
  page: ShellExternalPage;
  parsed: ParsedExternalUrl;
  /**
   * Everything wrong with this URL, from both halves of the check: what the
   * string says, and what answered when it was opened. One list, because a row
   * has one badge and a person has one question.
   */
  issues: ExternalUrlIssue[];
  status: ExternalUrlStatus;
  /** The reachability check, where one has been run. */
  probe?: ExternalUrlProbe;
  /**
   * How many places link to it, or null while the scan has not finished.
   *
   * Null rather than 0, because those are different answers and only one of
   * them is safe to delete on. See `ShellExternalPage.usagesComplete`.
   */
  usageCount: number | null;
};

/** Rows that share a registrable domain. */
export type ExternalPageGroup = {
  /** The domain, e.g. "example.com". The heading. */
  domain: string;
  rows: ExternalPageRowData[];
};

/** What the list is narrowed to, beyond the text filter. */
export type ExternalPageFilter = "all" | "unused" | "issues";

export function rowUsageCount(page: ShellExternalPage): number | null {
  if (page.usages === undefined) return null;
  // An empty list from an incomplete scan is "nothing found YET", and showing
  // it as `0 uses` invites a delete the scan would have prevented.
  if (page.usages.length === 0 && page.usagesComplete === false) return null;
  return page.usages.length;
}

export function toRows(
  pages: readonly ShellExternalPage[],
  issuesByUrl: ReadonlyMap<string, ExternalUrlIssue[]>,
  probes?: ReadonlyMap<string, ExternalUrlProbe>,
): ExternalPageRowData[] {
  return pages.map((page) => {
    const probe = probes?.get(page.url);
    const issues = [
      ...(issuesByUrl.get(page.url) ?? []),
      ...(probe?.state === "done" ? probeIssues(page.url, probe.result) : []),
    ];
    return {
      page,
      parsed: parseExternalUrl(page.url),
      issues,
      status: statusOf(issues),
      probe,
      usageCount: rowUsageCount(page),
    };
  });
}

/**
 * The text filter. Matches the URL, the entry's field values and the places it
 * is used, because all three are things someone would type looking for a link:
 * "instagram", "Careers", "footer".
 */
export function filterRows(
  rows: readonly ExternalPageRowData[],
  query: string,
  filter: ExternalPageFilter,
): ExternalPageRowData[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === "unused" && row.usageCount !== 0) return false;
    if (filter === "issues" && row.status === "ok") return false;
    if (q === "") return true;
    return (
      row.page.url.toLowerCase().includes(q) ||
      row.page.name.toLowerCase().includes(q) ||
      (row.page.fields ?? []).some((field) =>
        field.value.toLowerCase().includes(q),
      ) ||
      (row.page.usages ?? []).some((usage) =>
        usage.label.toLowerCase().includes(q),
      )
    );
  });
}

/**
 * Rows grouped under their registrable domain, domains A-Z.
 *
 * Alphabetical rather than by size: the list is something to FIND a link in,
 * and a heading order that changes when a link is added is one you cannot
 * learn. The one exception is the URLs that did not parse, which sort last -
 * they are a defect list, not a domain.
 */
export function groupRows(
  rows: readonly ExternalPageRowData[],
): ExternalPageGroup[] {
  const byDomain = new Map<string, ExternalPageRowData[]>();
  for (const row of rows) {
    const existing = byDomain.get(row.parsed.group);
    if (existing) {
      existing.push(row);
    } else {
      byDomain.set(row.parsed.group, [row]);
    }
  }
  return [...byDomain.entries()]
    .map(([domain, groupRows]) => ({
      domain,
      rows: [...groupRows].sort((a, b) => a.page.url.localeCompare(b.page.url)),
    }))
    .sort((a, b) => {
      if (a.domain === NOT_A_URL_GROUP) return 1;
      if (b.domain === NOT_A_URL_GROUP) return -1;
      return a.domain.localeCompare(b.domain);
    });
}

/** Rows in one flat, alphabetical list - the "no grouping" view. */
export function flatRows(
  rows: readonly ExternalPageRowData[],
): ExternalPageRowData[] {
  return [...rows].sort((a, b) => a.page.url.localeCompare(b.page.url));
}

/** How many of each status, for the toolbar and the check report. */
export function countStatuses(rows: readonly ExternalPageRowData[]): {
  ok: number;
  warning: number;
  error: number;
} {
  return {
    ok: rows.filter((row) => row.status === "ok").length,
    warning: rows.filter((row) => row.status === "warning").length,
    error: rows.filter((row) => row.status === "error").length,
  };
}
