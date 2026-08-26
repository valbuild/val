import { AvailableRoute } from "../NavMenu/NewPageForm";

/**
 * Types for the floating shell layout.
 *
 * These components are deliberately presentational: everything they render
 * comes in as props so the whole layout can be exercised from Storybook
 * without the Val providers. Wiring them to `ValProvider` & friends is a
 * separate step.
 */

/** A page in the site map. Pages nest arbitrarily deep. */
export type ShellPage = {
  /** Stable id, used for selection. */
  id: string;
  /** Display name, e.g. "Pricing". */
  name: string;
  /** URL path of the page, e.g. "/blogs/why-val". */
  urlPath: string;
  /**
   * Where the page's content lives, for navigation.
   *
   * Absent on a row that is only a path segment — `/blog` exists in the site
   * map because `/blog/why-val` does, but has no content of its own. Those
   * rows expand rather than open.
   */
  sourcePath?: string;
  /** Number of validation errors on this page (not descendants). */
  errorCount?: number;
  /** Whether the page has unpublished changes. */
  hasDraft?: boolean;
  /**
   * Whether Val tracks this route well enough to put it on a canvas.
   *
   * Only a route Val resolves — a `next-app-router` page, not an arbitrary
   * URL — can report the fields on it, so the canvas button appears only
   * where it would actually work.
   */
  isTracked?: boolean;
  /** Child pages. */
  children?: ShellPage[];
};

/**
 * An external page: a URL that lives outside the site but is still linkable
 * from content (Instagram, a customer portal, a help desk).
 */
export type ShellExternalPage = {
  id: string;
  /** Display name, e.g. "instagram.com/valbuild". */
  name: string;
  /** The full external URL. */
  url: string;
  /** Where the entry's content lives, for navigation. */
  sourcePath?: string;
  errorCount?: number;
};

/** A media gallery (an `s.images()` / `s.files()` module). */
export type ShellMediaGallery = {
  id: string;
  name: string;
  /** Directory the gallery is constrained to, e.g. "/public/val/images". */
  directory: string;
  /**
   * The gallery module itself. Selecting a gallery opens this module, which
   * is what renders the grid of files.
   */
  moduleFilePath: string;
  itemCount: number;
  mediaType: "images" | "files";
  /**
   * The files in the gallery.
   *
   * A gallery is a record keyed by file path, so its keys *are* its contents —
   * the panel does not have to fetch anything to list them. Absent while the
   * record is still loading, which is not the same as an empty gallery.
   */
  files?: ShellMediaFile[];
};

/** One file in a gallery. */
export type ShellMediaFile = {
  /**
   * The file's path, which is also its key in the gallery record —
   * `/public/val/images/logo_a1b2c.png`, or a remote ref.
   */
  ref: string;
  /** Where the entry lives, for opening it in the editor. */
  sourcePath: string;
};

/**
 * The routes a new page can be created under.
 *
 * `AvailableRoute` is the classic nav menu's type and `NewPageForm` is its form:
 * both already handle several routes at once, dynamic and catch-all segments,
 * optional segments and the schema author's description of a key. Reusing them
 * is the point — a second implementation of "what a route pattern means" would
 * be a second set of rules for what a URL may look like.
 */
export type ShellNewPageRoutes = {
  /** Every route in the project that accepts a new page. */
  routes: AvailableRoute[];
};

/** A non-router val module, shown under Data. */
export type ShellDataModule = {
  id: string;
  name: string;
  /** Module file path, e.g. "/content/settings.val.ts". */
  moduleFilePath: string;
  errorCount?: number;
  hasDraft?: boolean;
};

export type ShellNotificationKind =
  | "content"
  | "media"
  | "publish"
  | "validation";

export type ShellNotification = {
  id: string;
  kind: ShellNotificationKind;
  title: string;
  /** Human-readable relative time, e.g. "2 minutes ago". */
  timestamp: string;
  unread?: boolean;
};

/** A validation error, grouped by the item it belongs to. */
export type ShellValidationError = {
  id: string;
  /** The item the errors are on, e.g. "Products". */
  title: string;
  /** Where they are, e.g. "/content/products.val.ts". */
  detail: string;
  /** How many errors on that item. */
  count: number;
};

export type ShellActivityEntry = {
  /**
   * A React key, not a target: two patch sets can share a module and a path, so
   * this carries an index to keep them apart. Use `sourcePath` to go anywhere.
   */
  id: string;
  /** Where the change was, e.g. `/content/home.val.ts?p="hero"."title"`. */
  sourcePath: string;
  title: string;
  /** Already relative, e.g. "2 minutes ago". */
  timestamp: string;
  author?: string;
};

/**
 * A chat message. Assistant messages may carry `proposal`: a change the
 * assistant suggests, which the user has to explicitly apply. The assistant
 * never changes content on its own.
 */
export type ShellChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  proposal?: {
    /** What the proposal targets, e.g. "Home › Hero › Title". */
    target: string;
    /** The proposed replacement content. */
    content: string;
    /** Actions offered for this proposal. */
    actions: ShellProposalAction[];
  };
};

export type ShellProposalAction =
  | "insert"
  | "apply"
  | "replace"
  | "try-another";

/**
 * A content destination: what the left rail switches between.
 *
 * Its own type because a project does not necessarily have all three — a site
 * with no `s.router` has no Pages, a project with no `s.images()`/`s.files()`
 * has no Media — and several pieces of the shell have to agree on which are on
 * offer: the rail, the mobile switcher, the quick actions, and whichever panel
 * a fresh session opens on.
 */
export type ShellDestination = Extract<ShellPanel, "pages" | "media" | "data">;

/** Which floating panel is currently open. At most one at a time. */
export type ShellPanel =
  | "pages"
  | "media"
  | "data"
  | "settings"
  | "utility"
  | "ai"
  | "notifications";

/** Breakpoint the shell is rendering at. */
export type ShellBreakpoint = "mobile" | "tablet" | "desktop";

/**
 * Everything the shell needs to render.
 *
 * Optional fields are the ones Val cannot always answer — see
 * `useShellData`. They are optional rather than defaulted because the shell
 * hides the affordance when there is no data for it: a notification bell with
 * nothing behind it is worse than no bell.
 */
export type ShellData = {
  projectName: string;
  /** From `config.gitBranch`. Absent outside a git checkout. */
  branch?: string;
  /**
   * Whether the project declares any `s.router` module.
   *
   * Separate from `pages` being non-empty, because a router that has no entries
   * yet is still a project with pages — the site map is empty, not absent. The
   * shell hides the Pages destination on this rather than on `pages.length`, so
   * a project that has simply not made its first page keeps the way to make
   * one.
   */
  hasRouters: boolean;
  pages: ShellPage[];
  /**
   * Where a new page can go.
   *
   * Absent when the project has no route that accepts one — every router is
   * static, so there is no key to invent — which is what hides the New page
   * buttons rather than offering a form that can only say "no routes accept new
   * pages". See `collectNewPageRoutes`.
   */
  newPage?: ShellNewPageRoutes;
  externalPages: ShellExternalPage[];
  media: ShellMediaGallery[];
  data: ShellDataModule[];
  /**
   * Val has no notification feed. Left optional so the design can keep the
   * surface while the bell stays hidden until something populates it.
   */
  notifications?: ShellNotification[];
  /** Derived from patch sets. Absent while they are still loading. */
  activity?: ShellActivityEntry[];
  validationErrors: ShellValidationError[];
  /**
   * Static seed only. The live conversation comes from `useAI`, not from
   * here, so this stays optional and empty in the app.
   */
  chat?: ShellChatMessage[];
  /** Suggested prompts, from `config.ai.chat.suggestions`. */
  chatSuggestions?: string[];
  /** Absent until a profile has loaded, and in modes that have none. */
  user?: { name: string; initials: string; email?: string };
  /** Changes Publish would ship. */
  pendingChanges?: number;
  /**
   * Publishes and what happened to them after they left Val. Absent when the
   * project has no deployment feed, which hides the status bar's deploy item
   * entirely rather than showing an item that can never say anything.
   */
  deployments?: ShellDeployment[];
};

/**
 * One publish, tracked from the commit Val made to the site going live.
 *
 * Mirrors `ValEnrichedDeployment`: Val owns the commit, the host owns the
 * deployment, and the two are joined on the commit sha.
 */
export type ShellDeployment = {
  /** Commit the publish created. Identifies the deployment everywhere. */
  commitSha: string;
  /**
   * `created` is a commit Val has made but no deployment has claimed yet,
   * so it reads as queued rather than as a state of its own.
   */
  state: "created" | "pending" | "success" | "failure" | "error";
  /** Val's commit message. Null when only the deployment is known. */
  message: string | null;
  /** Who published, when known. */
  author?: string;
  /** Human-readable relative time, e.g. "2 minutes ago". */
  timestamp: string;
  /** True once Val has seen this commit serving the live site. */
  isLive: boolean;
};
