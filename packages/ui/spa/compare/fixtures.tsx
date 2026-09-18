import type { ReactNode } from "react";
import type { AuthorPatchInfo } from "../components/FieldPatchAuthors";
import type { Profile } from "../components/ValProvider";
import type { Description } from "../utils/describePath";
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

/**
 * A `Description` as a path alone produces it — nobody wrote a preview.
 *
 * The common case, and the one the view has to keep reading well: an
 * un-annotated project should look exactly as it did before `.preview()`
 * existed. `origin.title` is `"fallback"`, which is what every surface branches
 * on.
 */
function unnamed(pathLabel: string, url?: string): Description {
  return {
    title: pathLabel,
    subtitle: null,
    image: null,
    pathLabel,
    url: url ?? null,
    origin: { title: "fallback", subtitle: "fallback", image: "fallback" },
  };
}

/**
 * A `Description` where a developer's `.preview(...)` supplied the name.
 *
 * `pathLabel` is kept and is NOT the title: that is the whole point of the
 * shape. The key or route stays available as identity, so a surface can show
 * the name and still say which entry it is.
 */
function named(
  title: string,
  pathLabel: string,
  extra?: { subtitle?: string; url?: string },
): Description {
  return {
    title,
    subtitle: extra?.subtitle ?? null,
    image: null,
    pathLabel,
    url: extra?.url ?? null,
    origin: {
      title: "preview",
      subtitle: extra?.subtitle ? "preview" : "fallback",
      image: "fallback",
    },
  };
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
  undo?: CompareFieldRow["undo"],
): CompareFieldRow {
  return { id, label, change, before, after, path, authors, undo };
}

/** A plain discard, with nothing depending on it. */
const DISCARD: CompareFieldRow["undo"] = { kind: "discard" };

/**
 * A discard that drags later changes along.
 *
 * The prefix invariant: a later patch in the same set was written against a
 * state in which this one applied, so it cannot be left behind.
 */
function discardWith(...requires: string[]): CompareFieldRow["undo"] {
  return { kind: "discard", requires };
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
  description: unnamed("/"),
  path: "/app/page.val.ts",
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
          "Content, super-charged",
          "Content, super-charged — and yours to edit",
          undefined,
          byBoth(),
          DISCARD,
        ),
        field(
          "brand",
          "brand",
          "changed",
          swatch("hsl(217 91% 60%)", "hsl(217 91% 60%)"),
          swatch("hsl(262 83% 58%)", "hsl(262 83% 58%)"),
          "theme.brand",
          by("profile-linus", "replace", 55),
          discardWith("badge", "legacyNote"),
        ),
        field(
          "badge",
          "badge",
          "added",
          undefined,
          "New in 0.125",
          undefined,
          by("profile-ada", "add", 12),
          DISCARD,
        ),
        field(
          "legacyNote",
          "legacyNote",
          "removed",
          "Requires the beta channel.",
          undefined,
          undefined,
          by("profile-ada", "remove", 8),
          DISCARD,
        ),
        // Present so the "Show all fields" toggle has something to reveal.
        field(
          "subtitle",
          "subtitle",
          "unchanged",
          "Hard-coded content, without the hard-coding.",
          "Hard-coded content, without the hard-coding.",
        ),
        field(
          "ctaLabel",
          "ctaLabel",
          "unchanged",
          "Get started",
          "Get started",
        ),
        field("ctaHref", "ctaHref", "unchanged", "/docs", "/docs"),
      ],
    },
  ],
};

const authorsPane: ComparePane = {
  description: unnamed("Authors"),
  path: "/content/authors.val.ts",
  note: "record of 6",
  change: "changed",
  groups: [
    {
      kind: "list",
      id: "authors",
      title: "authors",
      summary: "1 added · 1 removed · 1 changed",
      rows: [
        item("kimmid", "kimmid", "added", {
          value: "Kim Midtlid",
          authors: by("profile-linus", "add", 200),
          undo: DISCARD,
        }),
        item("erlamd", "erlamd", "removed", {
          value: "Erlend Åmdal",
          authors: by("profile-ada", "remove", 30),
          undo: DISCARD,
        }),
        item("teddy", "teddy", "changed", {
          authors: by("profile-linus", "replace", 45),
          undo: DISCARD,
          fields: [
            field(
              "teddy-name",
              "name",
              "changed",
              "Theodor René Carlsen",
              "Theodor R. Carlsen",
            ),
            field(
              "teddy-birthdate",
              "birthdate",
              "unchanged",
              "1970-01-01",
              "1970-01-01",
            ),
          ],
        }),
      ],
    },
  ],
};

const listsPane: ComparePane = {
  description: unnamed("Lists"),
  path: "/content/lists.val.ts",
  change: "changed",
  groups: [
    {
      kind: "list",
      id: "keywords",
      title: "keywords",
      summary: "2 added · 1 removed · 1 moved",
      rows: [
        item("kw-history", "history", "added", {
          value: "history",
          authors: by("profile-ada", "add", 25),
          undo: DISCARD,
        }),
        item("kw-restore", "restore", "added", {
          value: "restore",
          authors: by("profile-ada", "add", 25),
          undo: DISCARD,
        }),
        item("kw-content", "content", "removed", {
          value: "content",
          authors: by("profile-linus", "remove", 60),
          undo: DISCARD,
        }),
        item("kw-publish", "publish", "moved", {
          value: "publish",
          authors: by("profile-linus", "move", 60),
          undo: DISCARD,
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
          undo: DISCARD,
          fields: [field("prio-2-v", "value", "changed", "3", "5")],
        }),
      ],
    },
  ],
};

const newBlogPane: ComparePane = {
  description: unnamed("/blogs/history-restore", "/blogs/history-restore"),
  path: "/app/blogs/[blog]/page.val.ts",
  note: "new page",
  change: "added",
  groups: [
    {
      kind: "fields",
      id: "new-page",
      rows: [
        field(
          "nb-title",
          "title",
          "added",
          undefined,
          "History, restored",
          undefined,
          by("profile-ada", "add", 40),
          DISCARD,
        ),
        field(
          "nb-ingress",
          "ingress",
          "added",
          undefined,
          "Val can now look back, and put part of it back.",
          undefined,
          by("profile-ada", "add", 40),
          DISCARD,
        ),
        field(
          "nb-hero",
          "hero",
          "added",
          undefined,
          swatch(
            "hero-a1b2c.jpg · 1600×900",
            "linear-gradient(135deg,#334155,#0f172a)",
          ),
          undefined,
          by("profile-ada", "file", 18),
          DISCARD,
        ),
      ],
    },
  ],
};

const removedBlogPane: ComparePane = {
  description: unnamed("/blogs/old-announcement", "/blogs/old-announcement"),
  path: "/app/blogs/[blog]/page.val.ts",
  note: "page removed",
  change: "removed",
  groups: [
    {
      kind: "fields",
      id: "removed-page",
      rows: [
        field(
          "rb-title",
          "title",
          "removed",
          "Announcing the beta",
          undefined,
          undefined,
          by("profile-ada", "remove", 50),
          DISCARD,
        ),
        field(
          "rb-ingress",
          "ingress",
          "removed",
          "The beta channel is open.",
          undefined,
          undefined,
          by("profile-ada", "remove", 50),
          DISCARD,
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
  description: unnamed("Pages"),
  path: "/app/blogs/[blog]/page.val.ts",
  note: "router record",
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
          undo: DISCARD,
          value: "History, restored",
          move: {
            kind: "rename",
            from: "/blogs/history-restore",
            to: "/blogs/history-and-restore",
          },
        }),
        item("route-edited", "/blogs/getting-started", "changed", {
          authors: by("profile-ada", "replace", 20),
          undo: DISCARD,
          fields: [
            field(
              "gs-title",
              "title",
              "changed",
              "Getting started",
              "Getting started with Val",
            ),
          ],
        }),
      ],
    },
  ],
};

const mediaPane: ComparePane = {
  description: unnamed("/public/val/images"),
  path: "s.imageset() gallery",
  note: "2 changes",
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
          undo: DISCARD,
          value: swatch(
            "1600×900 · image/jpeg",
            "linear-gradient(135deg,#334155,#0f172a)",
          ),
        }),
        item("img-old", "old-banner-9f3e1.png", "removed", {
          authors: by("profile-linus", "file", 70),
          undo: DISCARD,
          value: swatch(
            "1200×400 · image/png",
            "linear-gradient(135deg,#7f1d1d,#450a0a)",
          ),
        }),
      ],
    },
  ],
};

const settingsPane: ComparePane = {
  description: unnamed("Settings"),
  path: "/settings.val.ts",
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
          "Val Examples",
          "Val Examples — Next",
          undefined,
          by("profile-ada", "replace", 5),
          DISCARD,
        ),
        field("locale", "locale", "unchanged", "en", "en"),
        field("analytics", "analytics", "unchanged", "off", "off"),
      ],
    },
  ],
};

export const compareModel: CompareModel = {
  changeCount: 14,
  profiles: PROFILES,
  /*
   * Against Published, undoing means DISCARDING the staged patch. There is no
   * schema question — the result is a state that already existed — and no
   * whole-commit escape hatch, because the equivalent is discarding everything.
   */
  undo: { kind: "discard" },
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
      description: unnamed("hero-a1b2c.jpg"),
      path: "/public/val/images",
      note: "added",
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
              undefined,
              by("profile-ada", "file", 18),
              DISCARD,
            ),
            field(
              "hero-alt",
              "alt",
              "added",
              undefined,
              "The Studio, mid-restore",
              undefined,
              by("profile-ada", "add", 16),
              DISCARD,
            ),
          ],
        },
      ],
    },
    "media-old": {
      description: unnamed("old-banner-9f3e1.png"),
      path: "/public/val/images",
      note: "removed",
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
              undefined,
              by("profile-linus", "file", 70),
              DISCARD,
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

/**
 * Against a commit, where undoing means REVERTING rather than discarding.
 *
 * The changes in that commit already shipped — there is no patch left to
 * remove — so the only way back is to write the old value forward as a new
 * `replace`, which makes it entirely a schema question. `checkCompatibility`
 * answers it three ways and all three appear here:
 *
 * - `heading` is a plain string that is still a plain string: `yes`.
 * - `intro` is rich text, which the schema-vs-schema gate cannot judge, so it
 *   is `unknown` and OFFERED — the value-level check runs at confirm.
 * - `cta` was an object at the commit and is a discriminated union now, with
 *   no variant of that shape: `no`, and refused with the reason rather than
 *   given a control that cannot work.
 */
export const revertBasisModel: CompareModel = {
  ...commitBasisModel,
  undo: {
    kind: "revert",
    all: {
      label: "Restore everything from this commit",
      /*
       * The shape `revertAll` really returns: a reason per module. Two here,
       * for the two kinds that actually occur — a schema this Val cannot read
       * back, and a `.jsonValues()` module whose Source is entry markers and
       * so is blocked from any root `replace`.
       */
      blocked: [
        {
          moduleFilePath: "/content/handbook.val.ts",
          reason: "Schema was written by a newer Val and cannot be read here",
        },
        {
          moduleFilePath: "/content/kb.val.ts",
          reason:
            "A .jsonValues() module — writing its Source back would overwrite the c.json() imports",
        },
      ],
    },
  },
  panes: {
    ...commitBasisModel.panes,
    "page-landing": {
      description: unnamed("/"),
      path: "/app/page.val.ts",
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
              "Content, super-charged",
              "Content, super-charged — and yours to edit",
              undefined,
              byBoth(),
              { kind: "revert", compatibility: "yes" },
            ),
            field(
              "intro",
              "intro",
              "changed",
              "Hard-coded content, without the hard-coding.",
              "Content that ships with your code, and stays editable.",
              undefined,
              by("profile-ada", "replace", 30),
              { kind: "revert", compatibility: "unknown" },
            ),
            field(
              "cta",
              "cta",
              "changed",
              '{ label: "Get started", href: "/docs" }',
              '{ kind: "link", label: "Get started", href: "/docs" }',
              undefined,
              by("profile-linus", "replace", 85),
              {
                kind: "revert",
                compatibility: "no",
                reason: "cta is a union now — no variant has this shape",
              },
            ),
          ],
        },
      ],
    },
  },
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

/**
 * The same publish, on schemas whose authors wrote `.preview(...)`.
 *
 * Read against {@link compareModel}, which is the same content with nothing
 * named — that pair is the whole point. An un-annotated project has to keep
 * reading exactly as it did, and a project that named its things has to be
 * visibly better off without the names displacing anything you need.
 *
 * Three claims it is here to test:
 *
 * 1. **The key never leaves.** `kimmid` is called "Kim Midtlid" and still says
 *    `kimmid`, because the key is what matches an entry to its other side, what
 *    an editor greps for, and the only thing two people with the same name are
 *    told apart by.
 * 2. **A renamed page keeps both routes.** The title says what the page is; the
 *    `from → to` says what happened to it, and only the routes can be typed
 *    into a URL bar. See `Description.url`.
 * 3. **The nav is untouched.** It is a location, so it reads the same in both
 *    models even though titles would look nicer there — the rule in
 *    `core/src/preview.ts`, and `CompareNav`'s header says why.
 *
 * The record is deliberately MIXED: `teddy` previews, `erlamd` does not. A real
 * project is half-annotated for most of its life — a preview closure that
 * throws, a nullable value, a schema nobody has got to yet — and a view that
 * only looks right when every row is named is a view that looks wrong in
 * practice.
 */
const namedAuthorsPane: ComparePane = {
  description: named("Authors", "authors.val.ts", {
    subtitle: "6 people",
  }),
  path: "/content/authors.val.ts",
  note: "record of 6",
  change: "changed",
  groups: [
    {
      kind: "list",
      id: "authors",
      title: "authors",
      summary: "1 added · 1 removed · 1 changed",
      rows: [
        item("kimmid", "kimmid", "added", {
          description: named("Kim Midtlid", "kimmid"),
          value: "Kim Midtlid",
          authors: by("profile-linus", "add", 200),
          undo: DISCARD,
        }),
        /*
         * No description on purpose. A removed entry's preview has to be
         * computed from the BEFORE side — the after side has nothing to run the
         * closure over — and an adapter that forgets will produce exactly this
         * row. It has to stay readable when it does.
         */
        item("erlamd", "erlamd", "removed", {
          value: "Erlend Åmdal",
          authors: by("profile-ada", "remove", 30),
          undo: DISCARD,
        }),
        item("teddy", "teddy", "changed", {
          description: named("Theodor R. Carlsen", "teddy"),
          authors: by("profile-linus", "replace", 45),
          undo: DISCARD,
          fields: [
            field(
              "teddy-name",
              "name",
              "changed",
              "Theodor René Carlsen",
              "Theodor R. Carlsen",
            ),
          ],
        }),
      ],
    },
  ],
};

const namedRoutesPane: ComparePane = {
  description: named("Blog posts", "Pages"),
  path: "/app/blogs/[blog]/page.val.ts",
  note: "router record",
  change: "changed",
  groups: [
    {
      kind: "list",
      id: "blogs",
      title: "blogs",
      summary: "1 renamed · 1 changed",
      rows: [
        item("blog-renamed", "/blogs/history-and-restore", "moved", {
          description: named(
            "History, restored",
            "/blogs/history-and-restore",
            {
              url: "/blogs/history-and-restore",
            },
          ),
          move: {
            kind: "rename",
            from: "/blogs/history-restore",
            to: "/blogs/history-and-restore",
          },
          value: "History, restored",
          authors: by("profile-linus", "move", 90),
          undo: DISCARD,
        }),
        item("blog-getting-started", "/blogs/getting-started", "changed", {
          description: named(
            "Getting started with Val",
            "/blogs/getting-started",
            {
              url: "/blogs/getting-started",
            },
          ),
          authors: by("profile-ada", "replace", 20),
          undo: DISCARD,
          fields: [
            field(
              "gs-title",
              "title",
              "changed",
              "Getting started",
              "Getting started with Val",
            ),
          ],
        }),
      ],
    },
  ],
};

/** A module whose own schema previews, so its HEADING is a written name. */
const namedLandingPane: ComparePane = {
  description: named("Landing page", "/", { url: "/" }),
  path: "/app/page.val.ts",
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
          "Content, super-charged",
          "Content, super-charged — and yours to edit",
          undefined,
          byBoth(),
          DISCARD,
        ),
      ],
    },
  ],
};

export const previewedModel: CompareModel = {
  ...compareModel,
  panes: {
    ...compareModel.panes,
    "page-landing": namedLandingPane,
    "mod-authors": namedAuthorsPane,
    "page-renamed-blog": namedRoutesPane,
  },
};
