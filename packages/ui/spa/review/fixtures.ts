import type { Description } from "../utils/describePath";
import type { CompareAuthorship } from "../compare/types";
import type { ReviewModel, ReviewRow } from "./types";

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
  patchPath: string[],
  summary: string,
  authors: CompareAuthorship,
  extra?: Partial<ReviewRow>,
): ReviewRow {
  return {
    id,
    description,
    patchPath,
    summary,
    authors,
    lastUpdated: minutesAgo(12),
    patchCount: 1,
    staging: "staged",
    ...extra,
  };
}

export const PROFILES = {
  "profile-ada": { fullName: "Ada Lovelace", avatar: null },
  "profile-linus": { fullName: "Linus Pauling", avatar: null },
};

export const reviewModel: ReviewModel = {
  stagingEnabled: true,
  profiles: PROFILES,
  now: NOW,
  modules: [
    {
      moduleFilePath: "/app/page.val.ts",
      description: named("Landing page", "page"),
      rows: [
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
      ],
    },
    {
      moduleFilePath: "/content/authors.val.ts",
      description: named("Authors", "authors"),
      rows: [
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
      ],
    },
    {
      moduleFilePath: "/app/blogs/[blog]/page.val.ts",
      description: named("Blog posts", "Pages"),
      rows: [
        /*
         * Held back, and it pulls somebody else's work in if you stage it.
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
            staging: "held",
            alsoStages: ["Linus Pauling"],
          },
        ),
        row(
          "blogs-renamed",
          named("History, restored", "/blogs/history-and-restore"),
          ["/blogs/history-and-restore"],
          "Page renamed",
          by("profile-linus", "move", 90),
          { staging: "held" },
        ),
      ],
    },
    {
      moduleFilePath: "/content/media.val.ts",
      description: unnamed("media"),
      rows: [
        row(
          "media-hero",
          unnamed("hero-a1b2c.jpg"),
          ["/public/val/images/hero-a1b2c.jpg"],
          "Image added",
          by("profile-ada", "file", 8),
        ),
      ],
    },
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
 * Every checkbox is gone rather than present and inert — the rule
 * `PatchStaging.enabled` already states. Discard still works, because
 * discarding a patch does not need a group to put it in.
 */
export const noStagingReviewModel: ReviewModel = {
  ...reviewModel,
  stagingEnabled: false,
  modules: reviewModel.modules.map((group) => ({
    ...group,
    rows: group.rows.map((entry) => ({
      ...entry,
      staging: "staged" as const,
      alsoStages: undefined,
    })),
  })),
};

/** One patch set mid-flight, so the third checkbox state is on screen. */
export const partialStagingReviewModel: ReviewModel = {
  ...reviewModel,
  modules: reviewModel.modules.map((group) =>
    group.moduleFilePath === "/content/authors.val.ts"
      ? {
          ...group,
          rows: group.rows.map((entry) =>
            entry.id === "authors-kimmid"
              ? { ...entry, staging: "partial" as const }
              : entry,
          ),
        }
      : group,
  ),
};
