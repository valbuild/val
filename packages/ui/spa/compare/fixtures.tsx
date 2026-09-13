import type { ReactNode } from "react";
import type { AuthorPatchInfo } from "../components/FieldPatchAuthors";
import type { Profile } from "../components/ValProvider";
import type {
  CompareAuthorship,
  CompareFieldRow,
  CompareListItemRow,
  CompareModel,
  ComparePane,
} from "./types";

/**
 * A publish worth looking at.
 *
 * Modelled on `examples/next` so the shapes are ones the product actually
 * produces — a router with blog pages, an `s.record` of authors, an
 * `s.images()` gallery — rather than a tidy invention that would let a layout
 * bug hide. Every state the view can be in appears at least once: a page added,
 * a page removed, a page edited, a record with all four item kinds, an array
 * that was reordered, an image added and an image removed, a module whose
 * changes cancelled out, and a pane with unchanged fields to reveal.
 */

function text(value: string): ReactNode {
  return <span className="break-words">{value}</span>;
}

/** A stand-in for a rendered image cell. Real integration renders the field. */
function swatch(label: string, color: string): ReactNode {
  return (
    <span className="flex items-center gap-2">
      <span
        className="inline-block h-8 w-12 shrink-0 rounded border border-border-secondary"
        style={{ background: color }}
        aria-hidden
      />
      <span className="truncate text-xs text-fg-tertiary">{label}</span>
    </span>
  );
}

/** The two editors the mock content host knows, so ids line up with e2e. */
export const PROFILES: Record<string, Profile> = {
  "profile-ada": {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    avatar: null,
  },
  "profile-linus": {
    fullName: "Linus Pauling",
    email: "linus@example.com",
    avatar: null,
  },
};

/** Minutes ago, as an ISO string, so the popover's relative dates read sensibly. */
function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function patches(opType: string, minutes: number): AuthorPatchInfo[] {
  return [{ opType, createdAt: ago(minutes) }];
}

/** One author. */
function by(
  authorId: keyof typeof PROFILES | string,
  opType: string,
  minutes: number,
): CompareAuthorship {
  return { [authorId]: patches(opType, minutes) };
}

/** Two people on one change, which `PatchSets` produces routinely. */
function byBoth(): CompareAuthorship {
  return {
    "profile-ada": [
      { opType: "replace", createdAt: ago(140) },
      { opType: "replace", createdAt: ago(12) },
    ],
    "profile-linus": patches("replace", 55),
  };
}

function field(
  id: string,
  label: string,
  change: CompareFieldRow["change"],
  before?: ReactNode,
  after?: ReactNode,
  path?: string,
  authors?: CompareAuthorship,
): CompareFieldRow {
  return { id, label, change, before, after, path, authors };
}

function item(
  id: string,
  label: string,
  change: CompareListItemRow["change"],
  extra?: Partial<CompareListItemRow>,
): CompareListItemRow {
  return { id, label, change, ...extra };
}

const landingPane: ComparePane = {
  title: "/",
  subtitle: "/app/page.val.ts",
  change: "changed",
  groups: [
    {
      kind: "fields",
      id: "root",
      rows: [
        field(
          "heading",
          "heading",
          "changed",
          text("Content, super-charged"),
          text("Content, super-charged — and yours to edit"),
          undefined,
          byBoth(),
        ),
        field(
          "brand",
          "brand",
          "changed",
          swatch("hsl(217 91% 60%)", "hsl(217 91% 60%)"),
          swatch("hsl(262 83% 58%)", "hsl(262 83% 58%)"),
          "theme.brand",
          by("profile-linus", "replace", 55),
        ),
        field(
          "badge",
          "badge",
          "added",
          undefined,
          text("New in 0.125"),
          undefined,
          by("profile-ada", "add", 12),
        ),
        field(
          "legacyNote",
          "legacyNote",
          "removed",
          text("Requires the beta channel."),
          undefined,
          undefined,
          by("profile-ada", "remove", 8),
        ),
        // Present so the "Show all fields" toggle has something to reveal.
        field(
          "subtitle",
          "subtitle",
          "unchanged",
          text("Hard-coded content, without the hard-coding."),
          text("Hard-coded content, without the hard-coding."),
        ),
        field(
          "ctaLabel",
          "ctaLabel",
          "unchanged",
          text("Get started"),
          text("Get started"),
        ),
        field("ctaHref", "ctaHref", "unchanged", text("/docs"), text("/docs")),
      ],
    },
  ],
};

const authorsPane: ComparePane = {
  title: "authors.val.ts",
  subtitle: "/content/authors.val.ts — record of 6",
  change: "changed",
  groups: [
    {
      kind: "list",
      id: "authors",
      title: "authors",
      summary: "1 added · 1 removed · 1 changed",
      rows: [
        item("kimmid", "kimmid", "added", {
          preview: text("Kim Midtlid"),
          authors: by("profile-linus", "add", 200),
        }),
        item("erlamd", "erlamd", "removed", {
          preview: text("Erlend Åmdal"),
          authors: by("profile-ada", "remove", 30),
        }),
        item("teddy", "teddy", "changed", {
          authors: by("profile-linus", "replace", 45),
          fields: [
            field(
              "teddy-name",
              "name",
              "changed",
              text("Theodor René Carlsen"),
              text("Theodor R. Carlsen"),
            ),
            field(
              "teddy-birthdate",
              "birthdate",
              "unchanged",
              text("1970-01-01"),
              text("1970-01-01"),
            ),
          ],
        }),
      ],
    },
  ],
};

const listsPane: ComparePane = {
  title: "lists.val.ts",
  subtitle: "/content/lists.val.ts",
  change: "changed",
  groups: [
    {
      kind: "list",
      id: "keywords",
      title: "keywords",
      summary: "2 added · 1 removed · 1 moved",
      rows: [
        item("kw-history", "history", "added", {
          preview: text("history"),
          authors: by("profile-ada", "add", 25),
        }),
        item("kw-restore", "restore", "added", {
          preview: text("restore"),
          authors: by("profile-ada", "add", 25),
        }),
        item("kw-content", "content", "removed", {
          preview: text("content"),
          authors: by("profile-linus", "remove", 60),
        }),
        item("kw-publish", "publish", "moved", {
          preview: text("publish"),
          authors: by("profile-linus", "move", 60),
          move: { kind: "reorder", from: 3, to: 0 },
        }),
      ],
    },
    {
      kind: "list",
      id: "priorities",
      title: "priorities",
      summary: "1 changed",
      rows: [
        item("prio-2", "[2]", "changed", {
          authors: by("profile-ada", "replace", 15),
          fields: [field("prio-2-v", "value", "changed", text("3"), text("5"))],
        }),
      ],
    },
  ],
};

const newBlogPane: ComparePane = {
  title: "/blogs/history-restore",
  subtitle: "/app/blogs/[blog]/page.val.ts — new page",
  change: "added",
  groups: [
    {
      kind: "fields",
      id: "new-page",
      rows: [
        field("title", "title", "added", undefined, text("History, restored")),
        field(
          "ingress",
          "ingress",
          "added",
          undefined,
          text("Val can now look back, and put part of it back."),
        ),
        field(
          "hero",
          "hero",
          "added",
          undefined,
          swatch(
            "hero-a1b2c.jpg · 1600×900",
            "linear-gradient(135deg,#334155,#0f172a)",
          ),
        ),
      ],
    },
  ],
};

const removedBlogPane: ComparePane = {
  title: "/blogs/old-announcement",
  subtitle: "/app/blogs/[blog]/page.val.ts — page removed",
  change: "removed",
  groups: [
    {
      kind: "fields",
      id: "removed-page",
      rows: [
        field(
          "title",
          "title",
          "removed",
          text("Announcing the beta"),
          undefined,
        ),
        field(
          "ingress",
          "ingress",
          "removed",
          text("The beta channel is open."),
          undefined,
        ),
      ],
    },
  ],
};

/**
 * A router record whose key was renamed — i.e. a page that changed URL.
 *
 * The case `moved` exists for. `ChangeRecordPopover` emits this as a real
 * `{op: "move"}` and rewrites every referrer it found, so the rename is known
 * rather than guessed at. Shown beside an ordinary edit in the same record, so
 * the two marks can be told apart at a glance.
 */
const routesPane: ComparePane = {
  title: "blogs",
  subtitle: "/app/blogs/[blog]/page.val.ts — router record",
  change: "changed",
  groups: [
    {
      kind: "list",
      id: "routes",
      title: "blogs",
      summary: "1 renamed · 1 changed",
      rows: [
        item("route-renamed", "/blogs/history-and-restore", "moved", {
          authors: by("profile-linus", "move", 90),
          preview: text("History, restored"),
          move: {
            kind: "rename",
            from: "/blogs/history-restore",
            to: "/blogs/history-and-restore",
          },
        }),
        item("route-edited", "/blogs/getting-started", "changed", {
          authors: by("profile-ada", "replace", 20),
          fields: [
            field(
              "gs-title",
              "title",
              "changed",
              text("Getting started"),
              text("Getting started with Val"),
            ),
          ],
        }),
      ],
    },
  ],
};

const mediaPane: ComparePane = {
  title: "/public/val/images",
  subtitle: "s.images() gallery — 2 changes",
  change: "changed",
  groups: [
    {
      kind: "list",
      id: "images",
      title: "images",
      summary: "1 added · 1 removed",
      rows: [
        item("img-hero", "hero-a1b2c.jpg", "added", {
          authors: by("profile-ada", "file", 18),
          preview: swatch(
            "1600×900 · image/jpeg",
            "linear-gradient(135deg,#334155,#0f172a)",
          ),
        }),
        item("img-old", "old-banner-9f3e1.png", "removed", {
          authors: by("profile-linus", "file", 70),
          preview: swatch(
            "1200×400 · image/png",
            "linear-gradient(135deg,#7f1d1d,#450a0a)",
          ),
        }),
      ],
    },
  ],
};

const settingsPane: ComparePane = {
  title: "settings.val.ts",
  subtitle: "/settings.val.ts",
  change: "changed",
  groups: [
    {
      kind: "fields",
      id: "settings",
      rows: [
        field(
          "siteName",
          "siteName",
          "changed",
          text("Val Examples"),
          text("Val Examples — Next"),
          undefined,
          by("profile-ada", "replace", 5),
        ),
        field("locale", "locale", "unchanged", text("en"), text("en")),
        field("analytics", "analytics", "unchanged", text("off"), text("off")),
      ],
    },
  ],
};

export const compareModel: CompareModel = {
  changeCount: 14,
  profiles: PROFILES,
  left: { label: "Published", caption: "3 days ago · mockcommit0" },
  right: { label: "After publish", caption: "14 staged changes" },
  selectedBasisId: "published",
  basisOptions: [
    { id: "published", label: "Published", caption: "What is live now" },
    {
      id: "commit-51be",
      label: "Tighten the onboarding summary",
      caption: "Ada Lovelace · 3 days ago",
    },
    {
      id: "commit-ea4c",
      label: "Rename an author and retint the accent",
      caption: "Linus Pauling · 3 days ago",
    },
    { id: "deploy", label: "Last deploy", caption: "Production · 2 days ago" },
  ],
  sections: [
    {
      id: "pages",
      title: "Pages",
      nodes: [
        {
          id: "page-landing",
          label: "/",
          sublabel: "Landing page",
          kind: "page",
          change: "changed",
          changedCount: 4,
          authorIds: ["profile-ada", "profile-linus"],
        },
        {
          id: "folder-blogs",
          label: "blogs",
          kind: "folder",
          changedCount: 3,
          authorIds: ["profile-ada", "profile-linus"],
          children: [
            {
              id: "page-new-blog",
              label: "history-restore",
              sublabel: "/blogs/history-restore",
              kind: "page",
              change: "added",
              authorIds: ["profile-ada"],
            },
            {
              id: "page-removed-blog",
              label: "old-announcement",
              sublabel: "/blogs/old-announcement",
              kind: "page",
              change: "removed",
              authorIds: ["profile-ada"],
            },
            {
              id: "page-renamed-blog",
              // Short name like its siblings; `renamedFrom` takes the sublabel
              // slot, so the row reads "history-and-restore / was
              // /blogs/history-restore" rather than truncating a full URL.
              label: "history-and-restore",
              renamedFrom: "/blogs/history-restore",
              kind: "page",
              change: "moved",
              authorIds: ["profile-linus"],
            },
          ],
        },
      ],
    },
    {
      id: "content",
      title: "Content",
      nodes: [
        {
          id: "mod-authors",
          label: "authors.val.ts",
          sublabel: "/content",
          kind: "module",
          change: "changed",
          changedCount: 3,
          authorIds: ["profile-ada", "profile-linus"],
        },
        {
          id: "mod-lists",
          label: "lists.val.ts",
          sublabel: "/content",
          kind: "module",
          change: "changed",
          changedCount: 5,
          authorIds: ["profile-ada", "profile-linus"],
        },
        {
          id: "mod-settings",
          label: "settings.val.ts",
          sublabel: "/",
          kind: "module",
          change: "changed",
          changedCount: 1,
          authorIds: ["profile-ada"],
        },
      ],
    },
    {
      id: "media",
      title: "Media",
      nodes: [
        {
          id: "media-images",
          label: "/public/val/images",
          sublabel: "s.images()",
          kind: "media-dir",
          change: "changed",
          changedCount: 2,
          authorIds: ["profile-ada", "profile-linus"],
          children: [
            {
              id: "media-hero",
              label: "hero-a1b2c.jpg",
              kind: "media-file",
              change: "added",
              authorIds: ["profile-ada"],
            },
            {
              id: "media-old",
              label: "old-banner-9f3e1.png",
              kind: "media-file",
              change: "removed",
              authorIds: ["profile-linus"],
            },
          ],
        },
      ],
    },
  ],
  panes: {
    "page-landing": landingPane,
    "page-new-blog": newBlogPane,
    "page-removed-blog": removedBlogPane,
    "page-renamed-blog": routesPane,
    "mod-authors": authorsPane,
    "mod-lists": listsPane,
    "mod-settings": settingsPane,
    "media-images": mediaPane,
    "media-hero": {
      title: "hero-a1b2c.jpg",
      subtitle: "/public/val/images — added",
      change: "added",
      groups: [
        {
          kind: "fields",
          id: "hero-meta",
          rows: [
            field(
              "hero-file",
              "file",
              "added",
              undefined,
              swatch(
                "1600×900 · image/jpeg · 284 KB",
                "linear-gradient(135deg,#334155,#0f172a)",
              ),
            ),
            field(
              "hero-alt",
              "alt",
              "added",
              undefined,
              text("The Studio, mid-restore"),
            ),
          ],
        },
      ],
    },
    "media-old": {
      title: "old-banner-9f3e1.png",
      subtitle: "/public/val/images — removed",
      change: "removed",
      groups: [
        {
          kind: "fields",
          id: "old-meta",
          rows: [
            field(
              "old-file",
              "file",
              "removed",
              swatch(
                "1200×400 · image/png · 96 KB",
                "linear-gradient(135deg,#7f1d1d,#450a0a)",
              ),
              undefined,
            ),
          ],
        },
      ],
    },
  },
};

/** One module only — the narrow case, and the one a story can read at a glance. */
export const singleModuleModel: CompareModel = {
  changeCount: 1,
  profiles: PROFILES,
  left: { label: "Published", caption: "3 days ago" },
  right: { label: "After publish", caption: "1 staged change" },
  selectedBasisId: "published",
  basisOptions: compareModel.basisOptions,
  sections: [
    {
      id: "content",
      title: "Content",
      nodes: [
        {
          id: "mod-settings",
          label: "settings.val.ts",
          sublabel: "/",
          kind: "module",
          change: "changed",
          changedCount: 1,
          authorIds: ["profile-ada"],
        },
      ],
    },
  ],
  panes: { "mod-settings": settingsPane },
};

/**
 * A comparison against a past commit rather than against published.
 *
 * The same dialog with different side labels — which is the claim the basis
 * dropdown makes, and the one most worth being able to look at.
 */
export const commitBasisModel: CompareModel = {
  ...compareModel,
  selectedBasisId: "commit-ea4c",
  left: {
    label: "Rename an author and retint the accent",
    caption: "3 days ago",
    byline: "Linus Pauling",
  },
  right: { label: "After publish", caption: "14 staged changes" },
};

/**
 * A basis whose label is a real commit message.
 *
 * Commit messages are prose and routinely run long — `ValServer` even generates
 * one ("Val CMS update (N files changed)") and `commit-summary` writes them with
 * a model. So the header, the dropdown trigger and the phone tabs all have to
 * survive a label that is longer than the space it is given, and every one of
 * those is a different clipping context. This exists so that is visible rather
 * than discovered by a user with a verbose team.
 */
export const longCommitMessageModel: CompareModel = {
  ...compareModel,
  selectedBasisId: "commit-long",
  basisOptions: [
    ...compareModel.basisOptions,
    {
      id: "commit-long",
      label:
        "Rework the onboarding handbook, retint the accent colour and rename the history blog post so the URL matches the new title",
      caption: "Linus Pauling · 3 days ago",
    },
  ],
  left: {
    label:
      "Rework the onboarding handbook, retint the accent colour and rename the history blog post so the URL matches the new title",
    caption: "3 days ago",
    byline: "Linus Pauling",
  },
  right: { label: "After publish", caption: "14 staged changes" },
};

/** Nothing staged. The dialog still has to say something useful. */
export const emptyModel: CompareModel = {
  changeCount: 0,
  profiles: PROFILES,
  left: { label: "Published", caption: "3 days ago" },
  right: { label: "After publish", caption: "Nothing staged" },
  selectedBasisId: "published",
  basisOptions: compareModel.basisOptions,
  sections: [
    { id: "pages", title: "Pages", nodes: [] },
    { id: "content", title: "Content", nodes: [] },
    { id: "media", title: "Media", nodes: [] },
  ],
  panes: {},
};
