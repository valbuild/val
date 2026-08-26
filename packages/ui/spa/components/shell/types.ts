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
  /** Display name, e.g. "Instagram". */
  name: string;
  /** The full external URL. */
  url: string;
  errorCount?: number;
};

/** A media gallery (an `s.images()` / `s.files()` module). */
export type ShellMediaGallery = {
  id: string;
  name: string;
  /** Directory the gallery is constrained to, e.g. "/public/val/images". */
  directory: string;
  itemCount: number;
  mediaType: "images" | "files";
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
  id: string;
  title: string;
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
  pages: ShellPage[];
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
