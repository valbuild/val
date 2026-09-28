import type { MarkType, Node as PMNode, Schema } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";

/**
 * Turning URLs that were typed or pasted as TEXT into links.
 *
 * Pure: nothing here knows about a view, so the paste handler, the ⌘K command,
 * the typing rule and the "Link all" bar all ask the same two questions of the
 * same functions — where are the URLs ({@link scanLinks}), and what should each
 * one link to ({@link resolveUrl}).
 *
 * The second question is the one with an opinion in it. A URL on THIS site is
 * not an external link that happens to point home: `https://blank.no/jobb`
 * pasted into blank.no's own content becomes `/jobb`, because that is the link
 * that keeps working on a preview deployment, on localhost and after a domain
 * move. And because it is now a page of ours, we can tell whether the page
 * exists — so one that does not is an ERROR, never a link.
 */

/** Only these are offered as links. `mailto:` and friends are not "URLs pasted into text". */
const LINKABLE_PROTOCOLS = ["http:", "https:", "ftp:"];

/**
 * A URL as it appears in running text.
 *
 * It must carry its scheme — `www.example.com` and `/jobb` are left alone,
 * because both are also ordinary things to write in a sentence. It stops at
 * whitespace and at the characters that cannot be in an unencoded URL, and
 * {@link trimTrailing} takes off the punctuation the sentence put after it.
 */
const URL_PATTERN = new RegExp(
  "\\b(?:https?|ftp):\\/\\/[^\\s<>\"'`\\u00a0\\ufffc]+",
  "gi",
);

export interface LinkContext {
  /**
   * The origins that ARE this site, e.g. `["https://blank.no"]`.
   *
   * Compared by host, ignoring the scheme and a leading `www.`, so
   * `http://www.blank.no/jobb` is ours too. A port is compared only when the
   * origin has one, which is what makes `localhost:3000` not also match
   * `localhost:6006`.
   */
  siteOrigins: readonly string[];
  /**
   * Every route the project declares, or `undefined` when that is unknown.
   *
   * Only the ones starting with `/` are pages of this site — an
   * `externalPageRouter` contributes full URLs, which are somebody else's.
   * An empty list is "unknown", not "no pages": a project without a router
   * cannot say a page is missing.
   */
  routes: readonly string[] | undefined;
  /**
   * When the field can only link to a fixed catalog (`s.richtext({ a: true })`
   * links to routes), the hrefs it may use. `undefined` means any href.
   *
   * It matters because `createLinkCatalogPlugin` strips any link outside it,
   * so offering to link a URL that is not in it would be offering a link that
   * vanishes on the next keystroke.
   */
  allowedHrefs: readonly string[] | undefined;
}

export type UrlResolution =
  /** Link it, to `href`. `internal` when `href` is a path on this site. */
  | { status: "linkable"; href: string; internal: boolean }
  /** A URL on this site, for a page the project does not have. An error. */
  | { status: "missing-page"; path: string }
  /** A real target, but not one this field is allowed to link to. */
  | { status: "not-allowed"; href: string };

export interface LinkFinding {
  /** Document positions, in the document the scan was taken of. */
  from: number;
  to: number;
  /**
   * `text`: a bare URL, not a link yet. `link`: an existing link whose href
   * should change (a full address on this site) or does not resolve.
   */
  source: "text" | "link";
  /** The URL as written: the text, or the link's current href. */
  url: string;
  resolution: UrlResolution;
}

export interface LinkScan {
  /** Would become (or be rewritten to) a working link by "Link all". */
  fixable: LinkFinding[];
  /** On this site, and no such page. Shown as errors. */
  missing: LinkFinding[];
  /** Cannot be a link in this field at all. */
  notAllowed: LinkFinding[];
}

export const EMPTY_LINK_SCAN: LinkScan = {
  fixable: [],
  missing: [],
  notAllowed: [],
};

/**
 * Take off what the sentence added: `(see https://a.no/x).` ends at `x`.
 *
 * A closing bracket stays when the URL opened one — Wikipedia's
 * `/wiki/Foo_(bar)` is the URL, not the prose around it.
 */
function trimTrailing(url: string): string {
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    if (last === undefined) break;
    if (".,;:!?*_~".includes(last)) {
      end--;
      continue;
    }
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    const open = pairs[last];
    if (open !== undefined) {
      const head = url.slice(0, end);
      const opened = head.split(open).length - 1;
      const closed = head.split(last).length - 1;
      if (closed > opened) {
        end--;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

function parseLinkableUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!LINKABLE_PROTOCOLS.includes(url.protocol)) return null;
  if (!url.hostname) return null;
  return url;
}

/** URLs in a run of text, as `[start, end)` offsets into it. */
export function findUrlsInText(
  text: string,
): { start: number; end: number; url: string }[] {
  const found: { start: number; end: number; url: string }[] = [];
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    const url = trimTrailing(match[0]);
    if (parseLinkableUrl(url) === null) continue;
    found.push({ start: match.index, end: match.index + url.length, url });
  }
  return found;
}

/** True when `text` is one URL and nothing else — a paste of a link, not of prose. */
export function isSingleUrl(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return false;
  const urls = findUrlsInText(trimmed);
  return urls.length === 1 && urls[0].start === 0 && urls[0].url === trimmed;
}

function hostKey(hostname: string, port: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return port ? `${host}:${port}` : host;
}

function isOnSite(url: URL, siteOrigins: readonly string[]): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  for (const origin of siteOrigins) {
    let site: URL;
    try {
      site = new URL(origin);
    } catch {
      continue;
    }
    const sameHost =
      hostKey(url.hostname, "") === hostKey(site.hostname, "") &&
      (site.port === "" || site.port === url.port);
    if (sameHost) return true;
  }
  return false;
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * The route in `routes` that `path` names, spelled as `routes` spells it.
 *
 * Tried as written and percent-decoded, because a URL copied from a browser
 * has `/om-oss/%C3%A6` where the router key is `/om-oss/æ`.
 */
function findRoute(path: string, routes: readonly string[]): string | null {
  const wanted = new Set([withoutTrailingSlash(path)]);
  try {
    wanted.add(withoutTrailingSlash(decodeURIComponent(path)));
  } catch {
    // Not valid percent-encoding: the path as written is all there is.
  }
  for (const route of routes) {
    if (wanted.has(withoutTrailingSlash(route))) return route;
  }
  return null;
}

function sitePaths(routes: readonly string[] | undefined): string[] {
  return (routes ?? []).filter(
    (route) => route.startsWith("/") && !route.startsWith("//"),
  );
}

function sameExternalUrl(a: string, b: URL): boolean {
  const normalize = (href: string) => withoutTrailingSlash(href);
  const parsed = parseLinkableUrl(a.trim());
  return parsed !== null && normalize(parsed.href) === normalize(b.href);
}

/** The path, and the `?query#hash` after it, of a site-relative href. */
function splitPath(href: string): { path: string; tail: string } {
  const index = href.search(/[?#]/);
  return index === -1
    ? { path: href, tail: "" }
    : { path: href.slice(0, index), tail: href.slice(index) };
}

/**
 * What a path on this site should link to.
 *
 * With a catalog the href must be the catalog's own string — the route schema
 * validates by equality, so `/jobb?ref=x` is not `/jobb` and the query goes.
 * Without one the query and hash are kept, since `s.string()` takes any href.
 */
function resolveSitePath(
  path: string,
  tail: string,
  ctx: LinkContext,
): UrlResolution {
  const routes = sitePaths(ctx.routes);
  if (ctx.allowedHrefs !== undefined) {
    const allowed = findRoute(path, sitePaths(ctx.allowedHrefs));
    if (allowed !== null) {
      return { status: "linkable", href: allowed, internal: true };
    }
    const existing = findRoute(path, routes);
    if (existing !== null) {
      return { status: "not-allowed", href: existing };
    }
    return { status: "missing-page", path: withoutTrailingSlash(path) };
  }
  if (routes.length > 0) {
    const route = findRoute(path, routes);
    if (route === null) {
      return { status: "missing-page", path: withoutTrailingSlash(path) };
    }
    return { status: "linkable", href: route + tail, internal: true };
  }
  return { status: "linkable", href: path + tail, internal: true };
}

/**
 * What a URL written in the text should link to, or `null` when it is not a
 * URL we offer to link at all.
 */
export function resolveUrl(
  raw: string,
  ctx: LinkContext,
): UrlResolution | null {
  const url = parseLinkableUrl(raw.trim());
  if (url === null) return null;

  if (isOnSite(url, ctx.siteOrigins)) {
    return resolveSitePath(url.pathname || "/", url.search + url.hash, ctx);
  }

  if (ctx.allowedHrefs !== undefined) {
    const match = ctx.allowedHrefs.find((href) => sameExternalUrl(href, url));
    return match !== undefined
      ? { status: "linkable", href: match, internal: false }
      : { status: "not-allowed", href: raw.trim() };
  }
  return { status: "linkable", href: raw.trim(), internal: false };
}

/**
 * What is wrong with an EXISTING link's href, or `null` when nothing is.
 *
 * Two things can be: a full address on this site (fixable — the same rewrite a
 * pasted URL gets), or a path on this site with no page behind it.
 */
export function checkLinkHref(
  href: string,
  ctx: LinkContext,
): UrlResolution | null {
  const trimmed = href.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    // With a catalog, `createLinkCatalogPlugin` owns links outside it: they are
    // removed, and the text is what gets looked at next.
    if (ctx.allowedHrefs !== undefined) return null;
    if (sitePaths(ctx.routes).length === 0) return null;
    const { path, tail } = splitPath(trimmed);
    const resolution = resolveSitePath(path, tail, ctx);
    return resolution.status === "missing-page" ? resolution : null;
  }
  const url = parseLinkableUrl(trimmed);
  if (url === null || !isOnSite(url, ctx.siteOrigins)) return null;
  return resolveUrl(trimmed, ctx);
}

function classify(finding: LinkFinding, scan: LinkScan): void {
  switch (finding.resolution.status) {
    case "linkable":
      if (finding.source === "link" && finding.resolution.href === finding.url)
        return;
      scan.fixable.push(finding);
      return;
    case "missing-page":
      scan.missing.push(finding);
      return;
    case "not-allowed":
      // An existing link the field cannot hold is the catalog plugin's to
      // remove; only text is worth telling someone about.
      if (finding.source === "text") scan.notAllowed.push(finding);
      return;
  }
}

/**
 * Every bare URL and every link worth looking at, in document order.
 *
 * Code — a code block or text with the `code` mark — is never looked at: a URL
 * in a code sample is an example, and linking it changes what the sample says.
 */
export function scanLinks(
  doc: PMNode,
  schema: Schema,
  ctx: LinkContext,
): LinkScan {
  const linkType = schema.marks.link;
  if (!linkType) return EMPTY_LINK_SCAN;
  const codeType = schema.marks.code;
  const scan: LinkScan = { fixable: [], missing: [], notAllowed: [] };

  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true;
    if (block.type.spec.code) return false;

    // A run of plain text, possibly split into several nodes by bold and
    // italic. Positions are contiguous inside a run, so an offset into the
    // joined text is a position.
    let runStart = -1;
    let runText = "";
    const flushRun = () => {
      if (runStart !== -1) {
        for (const { start, end, url } of findUrlsInText(runText)) {
          const resolution = resolveUrl(url, ctx);
          if (resolution === null) continue;
          classify(
            {
              from: runStart + start,
              to: runStart + end,
              source: "text",
              url,
              resolution,
            },
            scan,
          );
        }
      }
      runStart = -1;
      runText = "";
    };

    let link: { from: number; to: number; href: string } | null = null;
    const flushLink = () => {
      if (link !== null) {
        const resolution = checkLinkHref(link.href, ctx);
        if (resolution !== null) {
          classify(
            {
              from: link.from,
              to: link.to,
              source: "link",
              url: link.href,
              resolution,
            },
            scan,
          );
        }
      }
      link = null;
    };

    block.forEach((child, offset) => {
      const pos = blockPos + 1 + offset;
      const linkMark = child.isText ? linkType.isInSet(child.marks) : null;
      if (linkMark) {
        flushRun();
        const href = String(linkMark.attrs.href ?? "");
        if (link !== null && link.href === href && link.to === pos) {
          link.to = pos + child.nodeSize;
        } else {
          flushLink();
          link = { from: pos, to: pos + child.nodeSize, href };
        }
        return;
      }
      flushLink();
      const isPlainText =
        child.isText && !(codeType && codeType.isInSet(child.marks));
      if (!isPlainText) {
        flushRun();
        return;
      }
      if (runStart === -1) runStart = pos;
      runText += child.text ?? "";
    });
    flushRun();
    flushLink();
    return false;
  });

  return scan;
}

/** Make each finding the link it resolves to. Findings that do not resolve to one are skipped. */
export function applyLinkFindings(
  tr: Transaction,
  findings: readonly LinkFinding[],
  linkType: MarkType,
): Transaction {
  for (const finding of findings) {
    if (finding.resolution.status !== "linkable") continue;
    tr.removeMark(finding.from, finding.to, linkType);
    tr.addMark(
      finding.from,
      finding.to,
      linkType.create({ href: finding.resolution.href }),
    );
  }
  return tr;
}

/** One sentence, for the error highlight and the bar. */
export function describeFinding(finding: LinkFinding): string {
  const { resolution } = finding;
  switch (resolution.status) {
    case "missing-page":
      return `There is no page at ${resolution.path} on this site`;
    case "not-allowed":
      return `${resolution.href} can't be linked from this field`;
    case "linkable":
      return `Link to ${resolution.href}`;
  }
}
