import type { Profile } from "../components/ValProvider";
import type { Description } from "../utils/describePath";
import type { CompareAuthorship } from "../compare/types";
import { prettyModuleLocation } from "../utils/prettyModulePath";
import type { ReviewModel, ReviewModuleGroup, ReviewRow } from "./types";

/**
 * The same publish the compare fixtures describe, seen as a publish decision.
 *
 * Deliberately the same content: the two screens are meant to be opened one
 * after the other, and a fixture that told a different story would hide
 * whether they agree.
 *
 * A fixed clock so the relative dates are the same in every screenshot —
 * `FieldPatchAuthorsPure` renders "12m ago", and a component that reads
 * `new Date()` itself cannot be compared against yesterday's screenshot.
 */
const NOW = new Date("2026-09-20T12:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function by(
  authorId: string,
  opType: string,
  minutes: number,
): CompareAuthorship {
  return { [authorId]: [{ opType, createdAt: minutesAgo(minutes) }] };
}

function byBoth(): CompareAuthorship {
  return {
    "profile-ada": [{ opType: "replace", createdAt: minutesAgo(140) }],
    "profile-linus": [{ opType: "replace", createdAt: minutesAgo(55) }],
  };
}

/** A path-derived name: nobody wrote a `.preview()` for this one. */
function unnamed(pathLabel: string): Description {
  return {
    title: pathLabel,
    subtitle: null,
    image: null,
    pathLabel,
    url: null,
    origin: { title: "fallback", subtitle: "fallback", image: "fallback" },
  };
}

/** A name a developer wrote, with the path kept beside it. */
function named(title: string, pathLabel: string): Description {
  return {
    title,
    subtitle: null,
    image: null,
    pathLabel,
    url: null,
    origin: { title: "preview", subtitle: "fallback", image: "fallback" },
  };
}

function row(
  id: string,
  description: Description,
  trail: string[],
  summary: string,
  authors: CompareAuthorship,
  extra?: Partial<ReviewRow>,
): ReviewRow {
  return {
    id,
    description,
    trail,
    summary,
    authors,
    lastUpdated: minutesAgo(12),
    patchCount: 1,
    staging: "staged",
    ...extra,
  };
}

/**
 * A module group, with its location derived from its path the way the adapter
 * will derive it — rather than typed out, which is how a fixture ends up
 * showing a spelling the real page can never produce.
 */
function group(
  moduleFilePath: string,
  description: Description,
  rows: ReviewRow[],
): ReviewModuleGroup {
  return {
    /*
     * A module group's id IS its module path; a page group's is the page's.
     * These fixtures are all modules, so the two coincide — the adapter is
     * where the distinction is made, and `toReviewModel.test.ts` is where it
     * is pinned.
     */
    id: moduleFilePath,
    moduleFilePath,
    description,
    location: prettyModuleLocation(moduleFilePath),
    rows,
  };
}

/**
 * A picture, inline, so the stories exercise the path that was broken.
 *
 * `Profile.avatar` is `{ url } | null`, and this page used to declare its own
 * `avatar?: string | null` and bridge the two with an assertion — which meant
 * `profile.avatar?.url` was `undefined` forever and no author here could ever
 * have a face. A fixture with `avatar: null` would have gone on hiding that,
 * because initials are also what a correct implementation draws for a profile
 * with no picture.
 *
 * A data URI rather than a URL: a screenshot must not depend on a network, and
 * the stories run offline.
 */
function portrait(background: string, initials: string): { url: string } {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${background}"/><circle cx="32" cy="25" r="12" fill="rgba(255,255,255,.85)"/><ellipse cx="32" cy="58" rx="20" ry="16" fill="rgba(255,255,255,.85)"/><text x="32" y="30" font-family="sans-serif" font-size="13" font-weight="700" fill="${background}" text-anchor="middle">${initials}</text></svg>`;
  return { url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
}

export const PROFILES: Record<string, Profile> = {
  "profile-ada": {
    fullName: "Ada Lovelace",
    avatar: portrait("#6d28d9", "AL"),
  },
  /* No picture, which is a real state: initials, from the same component. */
  "profile-linus": { fullName: "Linus Pauling", avatar: null },
};

export const reviewModel: ReviewModel = {
  stagingEnabled: true,
  profiles: PROFILES,
  mode: "http",
  /* Ada is looking, so "Mine" is one of the presets. */
  currentAuthorId: "profile-ada",
  now: NOW,
  modules: [
    group("/app/page.val.ts", named("Landing page", "page"), [
      row(
        "landing-heading",
        unnamed("heading"),
        ["heading"],
        "Text changed",
        byBoth(),
        { patchCount: 3 },
      ),
      row(
        "landing-brand",
        unnamed("brand"),
        ["theme", "brand"],
        "Colour changed",
        by("profile-linus", "replace", 55),
      ),
      row(
        "landing-badge",
        unnamed("badge"),
        ["badge"],
        "Added",
        by("profile-ada", "add", 12),
      ),
    ]),
    group("/content/authors.val.ts", named("Authors", "authors"), [
      row(
        "authors-kimmid",
        named("Kim Midtlid", "kimmid"),
        ["kimmid"],
        "Entry added",
        by("profile-linus", "add", 200),
        { patchCount: 2 },
      ),
      row(
        "authors-erlamd",
        unnamed("erlamd"),
        ["erlamd"],
        "Entry removed",
        by("profile-ada", "remove", 30),
      ),
      row(
        "authors-teddy",
        named("Theodor R. Carlsen", "teddy"),
        ["teddy", "name"],
        "Text changed",
        by("profile-linus", "replace", 45),
      ),
    ]),
    /*
     * A page module, whose location is the one that used to read
     * `/app/blogs/[blog]/page.val.ts`. It is `App / Blogs / Blog` now — the
     * same segments, spelled for someone who has never seen a Next route.
     */
    group("/app/blogs/[blog]/page.val.ts", named("Blog posts", "Pages"), [
      /*
       * Unstaged, and it pulls somebody else's work in if you stage it.
       *
       * Both states on one row on purpose: this is the case the page exists
       * to make legible, and it is the one a flat list of diffs cannot show
       * at all.
       */
      row(
        "blogs-getting-started",
        named("Getting started with Val", "/blogs/getting-started"),
        ["/blogs/getting-started", "title"],
        "Text changed",
        by("profile-ada", "replace", 20),
        {
          staging: "unstaged",
          alsoStages: ["Linus Pauling"],
        },
      ),
      row(
        "blogs-renamed",
        named("History, restored", "/blogs/history-and-restore"),
        ["/blogs/history-and-restore"],
        "Page renamed",
        by("profile-linus", "move", 90),
        { staging: "unstaged" },
      ),
    ]),
    group("/content/media.val.ts", unnamed("media"), [
      row(
        "media-hero",
        unnamed("hero-a1b2c.jpg"),
        /*
         * The gallery's key is `/public/val/images/hero-a1b2c.jpg`; what an
         * editor is shown is the file name. A route key would stay whole —
         * see `ReviewRow.trail`.
         */
        ["hero-a1b2c.jpg"],
        "Image added",
        by("profile-ada", "file", 8),
      ),
    ]),
  ],
};

/** Nothing pending: the state the page is in most of the time. */
export const emptyReviewModel: ReviewModel = {
  ...reviewModel,
  modules: [],
};

/**
 * fs mode, where the server cannot store patch groups.
 *
 * Stage and Unstage are gone rather than present and inert — the rule
 * `PatchStaging.enabled` already states. Revert still works, because dropping
 * a patch does not need a group to put it in.
 */
export const noStagingReviewModel: ReviewModel = {
  ...reviewModel,
  stagingEnabled: false,
  /* fs mode, which is also what an author-less change is named by. */
  mode: "fs",
  modules: reviewModel.modules.map((moduleGroup) => ({
    ...moduleGroup,
    rows: moduleGroup.rows.map((entry) => ({
      ...entry,
      staging: "staged" as const,
      alsoStages: undefined,
    })),
  })),
};

/** One patch set mid-flight, so the third checkbox state is on screen. */
export const partialStagingReviewModel: ReviewModel = {
  ...reviewModel,
  modules: reviewModel.modules.map((moduleGroup) =>
    moduleGroup.moduleFilePath === "/content/authors.val.ts"
      ? {
          ...moduleGroup,
          rows: moduleGroup.rows.map((entry) =>
            entry.id === "authors-kimmid"
              ? { ...entry, staging: "partial" as const }
              : entry,
          ),
        }
      : moduleGroup,
  ),
};
